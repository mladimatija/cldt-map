/**
 * Severe-weather warnings for Croatia from MeteoAlarm (issued by DHMZ), by
 * county.
 *
 * The feed is MeteoAlarm's JSON API: warnings[].alert.info[], one info per
 * language (hr-HR and en-GB). Warnings are kept unless they are below awareness
 * level 2 (green), an all-clear, past, expired (an info without `expires` is
 * kept), cancelled, or superseded by a later alert's `references`; upcoming
 * ones stay, so the map can show them and the banner can wait for them. Each
 * area names its county by EMMA_ID and NUTS 2021 level 3 code; warnings are
 * grouped by the NUTS code. Sea areas carry none and are skipped. The client
 * joins the result with the county outlines it loads once
 * (/data/meteoalarm-regions-hr.json; src/lib/severe-weather.ts).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { enforceRateLimit, fetchWithSizeCap } from '@/lib/api-defense';
import {
	AWARENESS_TYPES,
	SEVERITY_ORDER,
	type AwarenessType,
	type RegionWarning,
	type SevereWeatherResponse,
	type SeverityLevel,
} from '@/lib/severe-weather';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const METEOALARM_URL = 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-croatia';
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** awareness_level "2; yellow; Moderate" and up; 1 (green) is no warning. */
const LEVELS: Record<string, SeverityLevel> = { '2': 'yellow', '3': 'orange', '4': 'red' };
/** Croatian NUTS 2021 level 3 codes (counties and the City of Zagreb). */
const COUNTY_CODE_RE = /^HR0\d{2}$/;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CapValue {
	valueName?: string;
	value?: string;
}

interface CapInfo {
	language?: string;
	event?: string;
	responseType?: string[] | string;
	urgency?: string;
	onset?: string;
	effective?: string;
	expires?: string;
	senderName?: string;
	parameter?: CapValue[];
	area?: { areaDesc?: string; geocode?: CapValue[] }[];
}

interface CapAlert {
	identifier?: string;
	msgType?: string;
	references?: string;
	info?: CapInfo[];
}

interface MeteoAlarmFeed {
	warnings?: { alert?: CapAlert }[];
}

/* ------------------------------------------------------------------ */
/*  Feed parsing                                                       */
/* ------------------------------------------------------------------ */

function parameter(info: CapInfo, name: string): string | undefined {
	return info.parameter?.find((p) => p.valueName === name)?.value;
}

/** "2; yellow; Moderate" -> yellow; green and anything unknown -> null. */
function warningLevel(info: CapInfo): SeverityLevel | null {
	const raw = parameter(info, 'awareness_level');
	return raw ? (LEVELS[raw.split(';')[0].trim()] ?? null) : null;
}

/** "1; Wind" -> wind. */
function awarenessType(info: CapInfo): AwarenessType | null {
	const raw = parameter(info, 'awareness_type');
	const id = raw ? Number(raw.split(';')[0]) : NaN;
	return (AWARENESS_TYPES as Record<number, AwarenessType | undefined>)[id] ?? null;
}

/** Not over yet. CAP makes `expires` optional, so an info without a readable
 *  one is kept; upcoming warnings are kept too. */
function isActive(info: CapInfo, now: number): boolean {
	const responseTypes = Array.isArray(info.responseType) ? info.responseType : [info.responseType];
	if (responseTypes.includes('AllClear') || info.urgency === 'Past') return false;
	const expires = Date.parse(info.expires ?? '');
	return !Number.isFinite(expires) || expires > now;
}

/** Identifiers that a later alert updates or cancels. CAP `references` lists
 *  "sender,identifier,sent" triples separated by spaces. */
function supersededIdentifiers(feed: MeteoAlarmFeed): Set<string> {
	const ids = new Set<string>();
	for (const { alert } of feed.warnings ?? []) {
		for (const triple of alert?.references?.split(/\s+/) ?? []) {
			const id = triple.split(',')[1];
			if (id) ids.add(id);
		}
	}
	return ids;
}

function buildRegionWarnings(feed: MeteoAlarmFeed, language: string, now: number): SevereWeatherResponse {
	const superseded = supersededIdentifiers(feed);
	const byRegion = new Map<string, Map<string, RegionWarning>>();
	for (const { alert } of feed.warnings ?? []) {
		if (!alert?.identifier || alert.msgType === 'Cancel' || superseded.has(alert.identifier)) continue;
		const info = alert.info?.find((i) => i.language === language) ?? alert.info?.[0];
		if (!info || !isActive(info, now)) continue;
		const severity = warningLevel(info);
		if (!severity) continue;
		for (const area of info.area ?? []) {
			const code = area.geocode?.find((g) => g.valueName === 'NUTS3')?.value;
			if (!code || !COUNTY_CODE_RE.test(code)) continue;
			const warnings = byRegion.get(code) ?? new Map<string, RegionWarning>();
			warnings.set(alert.identifier, {
				id: alert.identifier,
				severity,
				event: info.event ?? '',
				awarenessType: awarenessType(info),
				validFrom: info.onset || info.effective || '',
				validUntil: info.expires ?? '',
				source: info.senderName ?? '',
			});
			byRegion.set(code, warnings);
		}
	}
	const regions: Record<string, RegionWarning[]> = {};
	for (const [code, byId] of byRegion) {
		regions[code] = [...byId.values()].sort(
			(a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || a.validFrom.localeCompare(b.validFrom),
		);
	}
	return { regions };
}

/* ------------------------------------------------------------------ */
/*  Empty response (reused in error paths)                             */
/* ------------------------------------------------------------------ */

const EMPTY_RESPONSE: SevereWeatherResponse = { regions: {} };

/* ------------------------------------------------------------------ */
/*  Route handler                                                      */
/* ------------------------------------------------------------------ */

const CACHE_HEADERS = {
	'Cache-Control': 'public, max-age=900, s-maxage=900',
};

export async function GET(request: NextRequest): Promise<Response> {
	const limited = await enforceRateLimit(request, { name: 'meteoalarm', windowMs: 60_000, max: 60 });
	if (limited) return limited;

	// The feed carries Croatian and English texts; other locales read English.
	// The locale stays in the query string, so the CDN caches each one apart.
	const language = request.nextUrl.searchParams.get('locale') === 'hr' ? 'hr-HR' : 'en-GB';

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		const fetched = await fetchWithSizeCap(
			METEOALARM_URL,
			{
				signal: controller.signal,
				next: { revalidate: 900 },
			},
			MAX_BODY_BYTES,
		);
		clearTimeout(timeout);

		if (!fetched.ok) {
			console.error(`[meteoalarm] ${fetched.reason}`);
			return NextResponse.json(EMPTY_RESPONSE, { headers: CACHE_HEADERS });
		}

		const body = buildRegionWarnings(JSON.parse(fetched.body) as MeteoAlarmFeed, language, Date.now());
		return NextResponse.json(body, { headers: CACHE_HEADERS });
	} catch (err) {
		console.error('[meteoalarm]', err instanceof Error ? err.message : String(err));
		return NextResponse.json(EMPTY_RESPONSE, { headers: CACHE_HEADERS });
	}
}
