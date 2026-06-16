/**
 * Personal water-status log: the hiker's own dated observation of what they
 * actually found at a water source ("flowing", "low", or "dry").
 *
 * This is a single-user, on-device annotation - the privacy-compatible answer
 * to crowdsourced water reports. It complements (does not replace) the static
 * OSM-derived `WaterInfo` reliability class: the official class says what the
 * source is tagged as, the personal log says what you saw and when. One latest
 * observation is kept per POI id (re-logging overwrites); everything stays in
 * the browser and is never uploaded.
 */

/** What the hiker found at a source on a given day. */
export type WaterStatus = 'flowing' | 'low' | 'dry';

export interface WaterLogEntry {
	status: WaterStatus;
	/** Calendar date of the observation (YYYY-MM-DD), device timezone. */
	date: string;
}

/** Button order in the popup: best to worst, so the row reads naturally. */
export const WATER_STATUS_OPTIONS = ['flowing', 'low', 'dry'] as const satisfies readonly WaterStatus[];

export function isWaterStatus(value: unknown): value is WaterStatus {
	return value === 'flowing' || value === 'low' || value === 'dry';
}

/** Today's calendar date as YYYY-MM-DD in the device timezone. */
export function waterLogToday(): string {
	const d = new Date();
	const pad = (n: number): string => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates a single rehydrated entry, returning null when malformed so a
 *  corrupt localStorage value can never render garbage in a popup. */
function sanitizeEntry(raw: unknown): WaterLogEntry | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (!isWaterStatus(r.status)) return null;
	if (typeof r.date !== 'string' || !ISO_DATE_RE.test(r.date)) return null;
	return { status: r.status, date: r.date };
}

/** Sanitizes the rehydrated `poiWaterLog` map, dropping any malformed entries.
 *  Always returns a fresh plain object (never the persisted reference). */
export function sanitizeWaterLog(raw: unknown): Record<string, WaterLogEntry> {
	if (!raw || typeof raw !== 'object') return {};
	const out: Record<string, WaterLogEntry> = {};
	for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
		const entry = sanitizeEntry(value);
		if (entry) out[id] = entry;
	}
	return out;
}
