/**
 * Client side of the AI narrative feature: turns an assembled TripBrief into
 * the compact fact outline /api/narrative expects, and swaps the returned
 * paragraphs into the brief. Every failure path resolves to null so the
 * caller can fall back to the templated narratives without ceremony - the
 * brief must never fail to export because the AI was unavailable.
 *
 * Privacy: the request carries plan facts only - stage km ranges, distances,
 * elevation, ETAs, the names of places already shown in the brief, alert
 * titles, and the locale. No coordinates, no GPS fixes.
 */
import type { TripBrief } from '@/lib/trip-brief';
import { formatEta } from '@/lib/distance-utils';
import { NARRATIVE_DIRECTION } from '@/lib/trip-brief-i18n';

export interface AiNarratives {
	overview: string;
	days: string[];
}

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_POIS_PER_DAY = 8;
const MAX_ALERTS_PER_DAY = 4;
/** Server rejects strings longer than 160 chars; trim defensively. */
const MAX_STR = 158;

function trim(s: string): string {
	return s.length > MAX_STR ? `${s.slice(0, MAX_STR - 1)}…`.replace('…', '...') : s;
}

/**
 * Requests AI narratives for the brief. Resolves null on any failure
 * (offline, rate-limited, unconfigured deploy, model hiccup, abort).
 */
export async function fetchAiNarratives(brief: TripBrief, signal?: AbortSignal): Promise<AiNarratives | null> {
	const locale = brief.meta.locale;
	const payload = {
		locale,
		directionLabel: trim(NARRATIVE_DIRECTION[locale][brief.meta.direction]),
		totalDistanceLabel: trim(`${Math.round(brief.overview.totalKm)} km`),
		etaLabel: trim(formatEta(brief.overview.totalDurationSec)),
		days: brief.days.map((day) => ({
			day: day.index + 1,
			kmRange: trim(`${Math.round(day.directionStartKm)}-${Math.round(day.directionEndKm)}`),
			distanceLabel: trim(day.distanceLabel),
			gainM: Math.max(0, Math.round(day.gainM)),
			lossM: Math.max(0, Math.round(day.lossM)),
			etaLabel: trim(formatEta(day.etaSec)),
			poiNames: day.pois.slice(0, MAX_POIS_PER_DAY).map((p) => trim(`${p.name} (${p.typeLabel})`)),
			alerts: day.seasonalAlerts.slice(0, MAX_ALERTS_PER_DAY).map((a) => trim(`${a.severity}: ${a.title}`)),
		})),
	};

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	const onOuterAbort = (): void => controller.abort();
	signal?.addEventListener('abort', onOuterAbort, { once: true });
	try {
		const res = await fetch('/api/narrative', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
			signal: controller.signal,
		});
		if (!res.ok) return null;
		const json = (await res.json()) as Partial<AiNarratives>;
		if (
			typeof json.overview !== 'string' ||
			!Array.isArray(json.days) ||
			json.days.length !== brief.days.length ||
			json.days.some((d) => typeof d !== 'string' || d.trim().length === 0)
		) {
			return null;
		}
		return { overview: json.overview, days: json.days };
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener('abort', onOuterAbort);
	}
}

/** Returns a copy of the brief with AI narratives swapped in and the
 *  localized disclaimer stamped on the meta so renderers print it on the
 *  cover. The caller resolves `disclaimer` from messages/*.json (the
 *  exporters run outside React/next-intl). */
export function applyAiNarratives(brief: TripBrief, ai: AiNarratives, disclaimer: string): TripBrief {
	return {
		...brief,
		meta: { ...brief.meta, aiDisclaimer: disclaimer },
		overview: { ...brief.overview, narrative: ai.overview },
		days: brief.days.map((day, i) => ({ ...day, narrative: ai.days[i] ?? day.narrative })),
	};
}
