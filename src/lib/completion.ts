/**
 * Section completion tracking - pure interval math over SOBO trail km.
 *
 * Progress is stored as a normalized list of [startKm, endKm] intervals:
 * sorted, non-overlapping, and merged when closer than MERGE_TOLERANCE_KM.
 * Three writers feed it (manual marking, GPS auto-record, imported-track
 * import) and three readers consume it (green map overlay, progress panel
 * stats, per-section breakdown), so the invariants live here in one place.
 */

export interface CompletionInterval {
	startKm: number;
	endKm: number;
}

/** Gaps narrower than this merge away - GPS jitter and snapped-point
 *  rounding should not fragment a day's hike into dozens of slivers. */
export const MERGE_TOLERANCE_KM = 0.05;

/** A GPS fix farther than this from the trail does not record progress. */
export const AUTO_TRACK_MAX_OFF_TRAIL_M = 150;

/** Consecutive auto-track fixes farther apart than this along the trail are
 *  treated as a teleport (tunnel, GPS glitch, app reopened elsewhere) and do
 *  not mark the stretch between them. */
export const AUTO_TRACK_MAX_JUMP_KM = 2;

/** Imported-track points farther than this from the trail do not count as
 *  having covered it. Matches the stats threshold in imported-tracks.ts. */
export const IMPORT_MAX_OFF_TRAIL_M = 50;

/** Gaps along the trail shorter than this are bridged when converting an
 *  imported track's snapped kms into intervals - tracks sample sparsely. */
export const IMPORT_BRIDGE_GAP_KM = 0.5;

function normalize(intervals: CompletionInterval[]): CompletionInterval[] {
	const sorted = intervals
		.filter((iv) => iv.endKm > iv.startKm)
		.map((iv) => ({ startKm: round(iv.startKm), endKm: round(iv.endKm) }))
		.sort((a, b) => a.startKm - b.startKm);
	const out: CompletionInterval[] = [];
	for (const iv of sorted) {
		const last = out[out.length - 1];
		if (last && iv.startKm <= last.endKm + MERGE_TOLERANCE_KM) {
			last.endKm = Math.max(last.endKm, iv.endKm);
		} else {
			out.push({ ...iv });
		}
	}
	return out;
}

function round(km: number): number {
	return Math.round(km * 1000) / 1000;
}

/** Adds [startKm, endKm] (any order) and returns the normalized set. */
export function addInterval(intervals: CompletionInterval[], startKm: number, endKm: number): CompletionInterval[] {
	const lo = Math.min(startKm, endKm);
	const hi = Math.max(startKm, endKm);
	if (hi - lo <= 0) return intervals;
	return normalize([...intervals, { startKm: lo, endKm: hi }]);
}

/** Removes [startKm, endKm] (any order) and returns the normalized set. */
export function removeInterval(intervals: CompletionInterval[], startKm: number, endKm: number): CompletionInterval[] {
	const lo = Math.min(startKm, endKm);
	const hi = Math.max(startKm, endKm);
	if (hi - lo <= 0) return intervals;
	const out: CompletionInterval[] = [];
	for (const iv of intervals) {
		if (iv.endKm <= lo || iv.startKm >= hi) {
			out.push(iv);
			continue;
		}
		if (iv.startKm < lo) out.push({ startKm: iv.startKm, endKm: lo });
		if (iv.endKm > hi) out.push({ startKm: hi, endKm: iv.endKm });
	}
	return normalize(out);
}

/** Total completed km across the set. */
export function totalCompletedKm(intervals: CompletionInterval[]): number {
	return intervals.reduce((sum, iv) => sum + (iv.endKm - iv.startKm), 0);
}

/** Km that would be newly completed after folding `toAdd` into `existing`. */
export function additionalKmFromIntervals(existing: CompletionInterval[], toAdd: CompletionInterval[]): number {
	let merged = existing;
	for (const iv of toAdd) {
		merged = addInterval(merged, iv.startKm, iv.endKm);
	}
	return totalCompletedKm(merged) - totalCompletedKm(existing);
}

/** Completed km that fall inside [startKm, endKm] - per-section stats. */
export function completedKmInRange(intervals: CompletionInterval[], startKm: number, endKm: number): number {
	const lo = Math.min(startKm, endKm);
	const hi = Math.max(startKm, endKm);
	let sum = 0;
	for (const iv of intervals) {
		const a = Math.max(iv.startKm, lo);
		const b = Math.min(iv.endKm, hi);
		if (b > a) sum += b - a;
	}
	return sum;
}

/**
 * Converts a bag of snapped trail kms (any order, e.g. from an imported GPX
 * track) into intervals, bridging gaps up to `bridgeGapKm`. Isolated single
 * points produce no interval - touching one trail point proves presence, not
 * a hiked stretch.
 */
export function intervalsFromKms(kms: number[], bridgeGapKm = IMPORT_BRIDGE_GAP_KM): CompletionInterval[] {
	if (kms.length < 2) return [];
	const sorted = [...kms].sort((a, b) => a - b);
	const out: CompletionInterval[] = [];
	let start = sorted[0];
	let prev = sorted[0];
	for (let i = 1; i < sorted.length; i++) {
		const k = sorted[i];
		if (k - prev > bridgeGapKm) {
			if (prev > start) out.push({ startKm: start, endKm: prev });
			start = k;
		}
		prev = k;
	}
	if (prev > start) out.push({ startKm: start, endKm: prev });
	return normalize(out);
}
