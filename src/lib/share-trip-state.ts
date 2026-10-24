/**
 * Encode / decode trip-local state (stage plan, waypoints, journal, completion,
 * starred POIs) into a single compact `trip` query param on share URLs.
 * Nothing is shared unless the sender opts in, and nothing is applied on the
 * receiving side without the import dialog (ShareTripImportDialog).
 */
import { useMapStore } from '@/lib/store';
import { getActiveStarredPoiIds, type SharedTripData, type StagePlan, type TrailDirection } from '@/lib/store/types';
import { SHARE_TARGET_MAX_LEN, SHARE_TRIP_PARAM_KEY } from '@/lib/share-url-constants';
import { newId, type JournalEntry, type UserWaypoint } from '@/lib/user-waypoints';
import { normalizeWaypointCategory } from '@/lib/waypoint-categories';
import { normalizeRestDays } from '@/lib/stage-rest-days';

const POI_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MAX_WAYPOINTS = 50;
const MAX_JOURNAL_ENTRIES = 40;
const MAX_DONE_INTERVALS = 150;
const MAX_STARS = 80;
const MAX_WAYPOINT_NAME = 80;
const MAX_WAYPOINT_NOTE = 200;
const MAX_JOURNAL_TEXT = 400;
const MAX_REST_DAYS = 60;

/** Compact wire format (short keys keep URLs within short-link limits). */
/**
 * Trip state carried in share links. Version 2 stores every trail km in SOBO
 * km (from Ilok), like the app. Version 1 links stored them in the travel
 * frame of the link's `dir`; normalizeShareTripStateToSobo converts those.
 */
export interface ShareTripStatePayload {
	v: 1 | 2;
	sp?: {
		s: number;
		e: number;
		st: [number, number][];
		b: 'd' | 'e';
		sd?: string;
		/** Rest-day anchors: 0-based stage indices a zero day follows. */
		r?: number[];
		/** Direction the plan was made for: 'n' for NOBO, absent for SOBO. */
		dr?: 'n';
	};
	wp?: { i?: string; la: number; ln: number; n: string; no?: string; tk?: number | null; c?: string }[];
	j?: { d: string; t: string; s?: number; e?: number; tr?: string; ti?: [number, number] }[];
	done?: [number, number][];
	stars?: string[];
}

function roundKm(value: number): number {
	return Math.round(value * 100) / 100;
}

function trimText(value: string, maxLen: number): string {
	if (value.length <= maxLen) return value;
	return value.slice(0, maxLen);
}

function encodeBase64Url(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(encoded: string): string | null {
	if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
	try {
		const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
		const pad = '='.repeat((4 - (padded.length % 4)) % 4);
		const binary = atob(padded + pad);
		const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

function encodeStagePlan(plan: StagePlan): ShareTripStatePayload['sp'] {
	return {
		s: roundKm(plan.startKm),
		e: roundKm(plan.endKm),
		st: plan.stages.map((stage) => [roundKm(stage.startKm), roundKm(stage.endKm)]),
		b: plan.balanceMode === 'eta' ? 'e' : 'd',
		...(plan.startDate && ISO_DATE_RE.test(plan.startDate) && { sd: plan.startDate }),
		...(plan.restDays?.length && { r: normalizeRestDays(plan.restDays).slice(0, MAX_REST_DAYS) }),
		...(plan.direction === 'NOBO' && { dr: 'n' as const }),
	};
}

function encodeWaypoint(wp: UserWaypoint): NonNullable<ShareTripStatePayload['wp']>[number] {
	return {
		...(POI_ID_RE.test(wp.id) && { i: wp.id }),
		la: Math.round(wp.lat * 1e5) / 1e5,
		ln: Math.round(wp.lng * 1e5) / 1e5,
		n: trimText(wp.name, MAX_WAYPOINT_NAME),
		...(wp.note && { no: trimText(wp.note, MAX_WAYPOINT_NOTE) }),
		...(wp.trailKm !== null && { tk: roundKm(wp.trailKm) }),
		...(wp.category && wp.category !== 'generic' && { c: wp.category }),
	};
}

function encodeJournal(entry: JournalEntry): NonNullable<ShareTripStatePayload['j']>[number] {
	return {
		d: entry.date,
		t: trimText(entry.text, MAX_JOURNAL_TEXT),
		...(entry.startKm !== undefined && { s: roundKm(entry.startKm) }),
		...(entry.endKm !== undefined && { e: roundKm(entry.endKm) }),
		...(entry.trackLink && { tr: entry.trackLink.trackId, ti: [entry.trackLink.startIdx, entry.trackLink.endIdx] }),
	};
}

/** Which trip-local parts a link carries. Every part defaults to off. */
export interface ShareTripStateParts {
	plan?: boolean;
	waypoints?: boolean;
	journal?: boolean;
	progress?: boolean;
	stars?: boolean;
	/** Only these waypoints (a waypoint link carries just the one it opens). */
	waypointIds?: readonly string[];
}

/** Read the requested trip-local parts from the map store. Returns null when
 *  none of them holds anything. */
export function collectShareTripStateFromStore(parts: ShareTripStateParts = {}): ShareTripStatePayload | null {
	const state = useMapStore.getState();
	const payload: ShareTripStatePayload = { v: 2 };
	let hasAny = false;

	if (parts.plan && state.stagePlan && state.stagePlan.stages.length > 0) {
		payload.sp = encodeStagePlan(state.stagePlan);
		hasAny = true;
	}
	const waypoints = parts.waypointIds
		? state.userWaypoints.filter((wp) => parts.waypointIds!.includes(wp.id))
		: state.userWaypoints;
	if (parts.waypoints && waypoints.length > 0) {
		payload.wp = waypoints.slice(0, MAX_WAYPOINTS).map(encodeWaypoint);
		hasAny = true;
	}
	if (parts.journal && state.journalEntries.length > 0) {
		payload.j = state.journalEntries.slice(0, MAX_JOURNAL_ENTRIES).map(encodeJournal);
		hasAny = true;
	}
	if (parts.progress && state.completedIntervals.length > 0) {
		payload.done = state.completedIntervals
			.slice(0, MAX_DONE_INTERVALS)
			.map((iv) => [roundKm(iv.startKm), roundKm(iv.endKm)]);
		hasAny = true;
	}
	// Export only the active starred collection as a flat `stars` array so share
	// URLs stay backward compatible.
	const starred = parts.stars ? getActiveStarredPoiIds(state) : new Set<string>();
	if (starred.size > 0) {
		const stars = [...starred].filter((id) => POI_ID_RE.test(id)).slice(0, MAX_STARS);
		if (stars.length > 0) {
			payload.stars = stars;
			hasAny = true;
		}
	}

	return hasAny ? payload : null;
}

function maxTripParamLen(url: URL): number {
	const clone = new URL(url.toString());
	clone.searchParams.delete(SHARE_TRIP_PARAM_KEY);
	const overhead = SHARE_TRIP_PARAM_KEY.length + 1;
	return Math.max(0, SHARE_TARGET_MAX_LEN - clone.search.length - overhead);
}

function compactPayloadForUrl(payload: ShareTripStatePayload, maxLen: number): ShareTripStatePayload | null {
	let current: ShareTripStatePayload = { ...payload };

	const tryEncode = (): string | null => {
		const json = JSON.stringify(current);
		if (json.length > 8000) return null;
		return encodeBase64Url(json);
	};

	let encoded = tryEncode();
	if (encoded && encoded.length <= maxLen) return current;

	if (current.j?.length) {
		current = {
			...current,
			j: current.j.map((entry) => ({ ...entry, t: trimText(entry.t, 120) })),
		};
		encoded = tryEncode();
		if (encoded && encoded.length <= maxLen) return current;

		const trimmedJournal = current.j?.slice(0, 15);
		if (trimmedJournal?.length) {
			current = { ...current, j: trimmedJournal };
			encoded = tryEncode();
			if (encoded && encoded.length <= maxLen) return current;
		}

		const { j: _j, ...withoutJournal } = current;
		current = withoutJournal;
		encoded = tryEncode();
		if (encoded && encoded.length <= maxLen) return current;
	}

	if (current.wp?.length) {
		current = { ...current, wp: current.wp.slice(0, 20) };
		encoded = tryEncode();
		if (encoded && encoded.length <= maxLen) return current;

		const { wp: _wp, ...withoutWaypoints } = current;
		current = withoutWaypoints;
		encoded = tryEncode();
		if (encoded && encoded.length <= maxLen) return current;
	}

	if (current.done?.length) {
		current = { ...current, done: current.done.slice(0, 50) };
		encoded = tryEncode();
		if (encoded && encoded.length <= maxLen) return current;
	}

	return encoded && encoded.length <= maxLen ? current : null;
}

/** Append a `trip` param carrying the requested parts, when any holds data. */
export function appendShareTripStateToUrl(url: URL, parts: ShareTripStateParts = {}): void {
	const payload = collectShareTripStateFromStore(parts);
	if (!payload) return;

	const maxLen = maxTripParamLen(url);
	if (maxLen < 32) return;

	const compact = compactPayloadForUrl(payload, maxLen);
	if (!compact) return;

	const encoded = encodeBase64Url(JSON.stringify(compact));
	if (encoded.length > maxLen) return;

	url.searchParams.set(SHARE_TRIP_PARAM_KEY, encoded);
}

/** `href` with a `trip` param for the requested parts (unchanged when empty). */
export function withShareTripState(href: string, parts: ShareTripStateParts): string {
	const url = new URL(href);
	appendShareTripStateToUrl(url, parts);
	return url.toString();
}

function parseStagePlan(raw: unknown): StagePlan | null {
	if (!raw || typeof raw !== 'object') return null;
	const sp = raw as ShareTripStatePayload['sp'];
	if (!sp || typeof sp.s !== 'number' || typeof sp.e !== 'number' || !Array.isArray(sp.st)) return null;
	if (!Number.isFinite(sp.s) || !Number.isFinite(sp.e) || sp.st.length === 0) return null;

	const stages = sp.st
		.map((pair) => {
			if (!Array.isArray(pair) || pair.length !== 2) return null;
			const [startKm, endKm] = pair;
			if (!Number.isFinite(startKm) || !Number.isFinite(endKm) || endKm <= startKm) return null;
			return { startKm: roundKm(startKm), endKm: roundKm(endKm) };
		})
		.filter((stage): stage is { startKm: number; endKm: number } => stage !== null);

	if (stages.length === 0) return null;

	// Rest-day anchors must point at a real stage index; out-of-range or junk
	// values are dropped. Duplicates survive (a multi-day rest). normalizeRestDays
	// handles the integer/>= 0/sort rule; the upper bound and cap are share-specific.
	const restDays = Array.isArray(sp.r)
		? normalizeRestDays(sp.r)
				.filter((v) => v < stages.length)
				.slice(0, MAX_REST_DAYS)
		: [];

	return {
		startKm: roundKm(sp.s),
		endKm: roundKm(sp.e),
		stages,
		balanceMode: sp.b === 'e' ? 'eta' : 'distance',
		...(sp.sd && ISO_DATE_RE.test(sp.sd) && { startDate: sp.sd }),
		...(restDays.length > 0 && { restDays }),
		direction: sp.dr === 'n' ? 'NOBO' : 'SOBO',
	};
}

function parseWaypoints(raw: unknown): UserWaypoint[] {
	if (!Array.isArray(raw)) return [];
	const now = new Date().toISOString();
	const result: UserWaypoint[] = [];

	for (const item of raw.slice(0, MAX_WAYPOINTS)) {
		if (!item || typeof item !== 'object') continue;
		const wp = item as NonNullable<ShareTripStatePayload['wp']>[number];
		if (typeof wp.la !== 'number' || typeof wp.ln !== 'number' || typeof wp.n !== 'string') continue;
		if (!Number.isFinite(wp.la) || !Number.isFinite(wp.ln)) continue;
		const id = typeof wp.i === 'string' && POI_ID_RE.test(wp.i) && !result.some((w) => w.id === wp.i) ? wp.i : newId();
		const category = normalizeWaypointCategory(typeof wp.c === 'string' ? wp.c : undefined);
		result.push({
			id,
			lat: wp.la,
			lng: wp.ln,
			name: trimText(wp.n, MAX_WAYPOINT_NAME),
			note: wp.no ? trimText(wp.no, MAX_WAYPOINT_NOTE) : '',
			trailKm: wp.tk !== undefined && wp.tk !== null && Number.isFinite(wp.tk) ? roundKm(wp.tk) : null,
			category,
			createdAt: now,
		});
	}

	return result;
}

function parseJournal(raw: unknown): JournalEntry[] {
	if (!Array.isArray(raw)) return [];
	const now = new Date().toISOString();
	const result: JournalEntry[] = [];

	for (const item of raw.slice(0, MAX_JOURNAL_ENTRIES)) {
		if (!item || typeof item !== 'object') continue;
		const entry = item as NonNullable<ShareTripStatePayload['j']>[number];
		if (typeof entry.d !== 'string' || typeof entry.t !== 'string') continue;
		if (!ISO_DATE_RE.test(entry.d)) continue;
		const trackRef = typeof entry.tr === 'string' && /^[a-f0-9]{8}$/i.test(entry.tr) ? entry.tr : undefined;
		const trackIdx =
			Array.isArray(entry.ti) &&
			entry.ti.length === 2 &&
			Number.isFinite(entry.ti[0]) &&
			Number.isFinite(entry.ti[1]) &&
			entry.ti[1] >= entry.ti[0]
				? ([Math.floor(entry.ti[0]), Math.floor(entry.ti[1])] as [number, number])
				: undefined;
		result.push({
			id: newId(),
			date: entry.d,
			text: trimText(entry.t, MAX_JOURNAL_TEXT),
			...(entry.s !== undefined && Number.isFinite(entry.s) && { startKm: roundKm(entry.s) }),
			...(entry.e !== undefined && Number.isFinite(entry.e) && { endKm: roundKm(entry.e) }),
			...(trackRef &&
				trackIdx && {
					trackLink: {
						trackId: trackRef,
						startIdx: trackIdx[0],
						endIdx: trackIdx[1],
						trackName: '',
					},
				}),
			createdAt: now,
		});
	}

	return result;
}

function parseDone(raw: unknown): [number, number][] {
	if (!Array.isArray(raw)) return [];
	const result: [number, number][] = [];
	for (const item of raw.slice(0, MAX_DONE_INTERVALS)) {
		if (!Array.isArray(item) || item.length !== 2) continue;
		const [startKm, endKm] = item;
		if (!Number.isFinite(startKm) || !Number.isFinite(endKm) || endKm <= startKm) continue;
		result.push([roundKm(startKm), roundKm(endKm)]);
	}
	return result;
}

function parseStars(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((id): id is string => typeof id === 'string' && POI_ID_RE.test(id)).slice(0, MAX_STARS);
}

/** Decode a `trip` query value. Returns null on missing or invalid input. */
export function parseShareTripStateParam(raw: string | null): ShareTripStatePayload | null {
	if (!raw) return null;
	const json = decodeBase64Url(raw);
	if (!json) return null;
	try {
		const parsed = JSON.parse(json) as ShareTripStatePayload;
		if (parsed?.v !== 1 && parsed?.v !== 2) return null;
		return parsed;
	} catch {
		return null;
	}
}

/** True when applying `payload` needs the trail length first (a northbound version 1 link). */
function shareTripStateNeedsTrailLength(payload: ShareTripStatePayload, linkDirection: TrailDirection): boolean {
	return payload.v === 1 && linkDirection === 'NOBO';
}

/**
 * Converts a payload to version 2 (SOBO km). Version 1 links from a NOBO
 * sender stored km from Prevlaka, so those are mirrored with total - km, and
 * ranges swap ends. Version 1 SOBO links were SOBO already.
 */
export function normalizeShareTripStateToSobo(
	payload: ShareTripStatePayload,
	linkDirection: TrailDirection,
	totalKm: number,
): ShareTripStatePayload {
	if (!shareTripStateNeedsTrailLength(payload, linkDirection)) return { ...payload, v: 2 };
	const m = (km: number): number => Math.max(0, totalKm - km);
	return {
		...payload,
		v: 2,
		...(payload.sp && {
			sp: {
				...payload.sp,
				s: m(payload.sp.e),
				e: m(payload.sp.s),
				st: payload.sp.st.map(([a, b]): [number, number] => [m(b), m(a)]),
				dr: 'n' as const,
			},
		}),
		...(payload.wp && {
			wp: payload.wp.map((wp) => (typeof wp.tk === 'number' ? { ...wp, tk: m(wp.tk) } : wp)),
		}),
		...(payload.j && {
			j: payload.j.map((entry) =>
				typeof entry.s === 'number' && typeof entry.e === 'number' ? { ...entry, s: m(entry.e), e: m(entry.s) } : entry,
			),
		}),
		...(payload.done && { done: payload.done.map(([a, b]): [number, number] => [m(b), m(a)]) }),
	};
}

/** Decode a version 2 (SOBO km) payload into trip data for the import
 *  dialog, dropping anything malformed. See normalizeShareTripStateToSobo. */
export function parseShareTripState(payload: ShareTripStatePayload): SharedTripData {
	return {
		stagePlan: payload.sp ? parseStagePlan(payload.sp) : null,
		waypoints: payload.wp ? parseWaypoints(payload.wp) : [],
		journal: payload.j ? parseJournal(payload.j) : [],
		done: payload.done ? parseDone(payload.done) : [],
		stars: payload.stars ? parseStars(payload.stars) : [],
	};
}

/** True when decoded trip data holds anything to import. */
export function sharedTripHasData(data: SharedTripData): boolean {
	return (
		data.stagePlan !== null ||
		data.waypoints.length > 0 ||
		data.journal.length > 0 ||
		data.done.length > 0 ||
		data.stars.length > 0
	);
}
