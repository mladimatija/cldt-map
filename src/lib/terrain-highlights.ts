import { sacMaxForKmRange, type SacScale, type TrailOsmTagRun } from '@/lib/trail-osm-tags';

/**
 * Grade-based "toughest stretches" detector for the multi-day stage planner.
 *
 * Scans the enhanced trail points within a stage's km window, merges consecutive
 * steep points into contiguous climb / descent stretches, and ranks them by a
 * sustained-severity metric (length x average absolute grade). Unlike SAC (which
 * only covers the alpine sub-ranges OSM tags), per-point grade covers the whole
 * trail, so this list is honest everywhere; each stretch is secondarily annotated
 * with the SAC class where the OSM data happens to tag that sub-range.
 *
 * Pure module: it takes points + runs as arguments, so it stays free of React /
 * store imports and is trivially reusable by exporters.
 */

/**
 * Minimal enhanced-point shape the scanner needs. EnhancedTrailPoint satisfies it
 * structurally, so callers pass the store array directly.
 */
export interface TerrainPoint {
	/** Cumulative distance from the direction start, in meters. */
	distanceFromStart: number;
	/** Signed grade percent (positive = climbing in the current travel direction). */
	gradePct: number;
	/** Bucketed |gradePct|: 0 flat, 1 moderate, 2 steep, 3 very steep, 4 extreme. */
	gradeBand: 0 | 1 | 2 | 3 | 4;
}

/**
 * Grade band at or above which a segment counts as a crux candidate. Band 2 is
 * the "steep" band (|grade| > 6%) in the shared grade-band scale used by the
 * grade-tinted trail style, so this reuses the existing thresholds rather than
 * inventing a new cutoff.
 */
export const CRUX_MIN_GRADE_BAND = 2;

/**
 * Ignore merged stretches shorter than this (km). Sub-threshold blips of a few
 * dozen metres are not "stretches"; the severity ranking already down-weights
 * them, but the floor keeps a lone 30 m pitch from being crowned the crux of an
 * otherwise gentle stage.
 */
export const MIN_CRUX_STRETCH_KM = 0.15;

export interface ToughestStretch {
	/** km bounds in the same frame as the enhanced points' distanceFromStart. */
	fromKm: number;
	toKm: number;
	kind: 'climb' | 'descent';
	/** Average |grade| percent across the stretch. */
	avgGradePct: number;
	/** SAC class the OSM data tags over this sub-range, when tagged. */
	sacClass?: SacScale;
}

interface RawStretch {
	startIdx: number;
	endIdx: number;
	sumAbs: number;
	count: number;
	sign: 1 | -1;
}

/**
 * Top `maxN` toughest stretches within [fromKm, toKm], ranked most-severe first.
 * `runs` is optional; when present each stretch is annotated with the hardest
 * SAC class overlapping its sub-range (via sacMaxForKmRange), otherwise sacClass
 * is omitted. Returns [] when the window has too few points to form a segment.
 */
export function findToughestStretches(
	points: readonly TerrainPoint[],
	fromKm: number,
	toKm: number,
	runs: readonly TrailOsmTagRun[] = [],
	maxN = 3,
): ToughestStretch[] {
	if (points.length < 2 || maxN <= 0) return [];
	const loM = Math.min(fromKm, toKm) * 1000;
	const hiM = Math.max(fromKm, toKm) * 1000;

	// Points inside the stage window, in travel order.
	const slice: TerrainPoint[] = [];
	for (const p of points) {
		if (p.distanceFromStart >= loM && p.distanceFromStart <= hiM) slice.push(p);
	}
	if (slice.length < 2) return [];

	// Merge consecutive steep points sharing a sign (all climb or all descent)
	// into contiguous stretches; a flat / gentle point or a sign flip ends one.
	const stretches: RawStretch[] = [];
	let current: RawStretch | null = null;
	// Mirror of current.sign; kept in a plain variable so the merge test reads
	// `current && currentSign === sign` (a truthiness guard plus a comparison on
	// a separate value) instead of `current.sign`, which the optional-chain lint
	// rule would rewrite into a form that trips a TS control-flow false positive.
	let currentSign: 1 | -1 | 0 = 0;
	for (let i = 0; i < slice.length; i++) {
		const p = slice[i];
		const steep = p.gradeBand >= CRUX_MIN_GRADE_BAND && p.gradePct !== 0;
		if (!steep) {
			if (current) stretches.push(current);
			current = null;
			currentSign = 0;
			continue;
		}
		const sign: 1 | -1 = p.gradePct >= 0 ? 1 : -1;
		if (current && currentSign === sign) {
			current.endIdx = i;
			current.sumAbs += Math.abs(p.gradePct);
			current.count += 1;
		} else {
			if (current) stretches.push(current);
			current = { startIdx: i, endIdx: i, sumAbs: Math.abs(p.gradePct), count: 1, sign };
			currentSign = sign;
		}
	}
	if (current) stretches.push(current);

	const hasRuns = runs.length > 0;
	const scored: { stretch: ToughestStretch; severity: number }[] = [];
	for (const s of stretches) {
		const startM = slice[s.startIdx].distanceFromStart;
		// grade at endIdx describes the segment to the next point; extend to it
		// when present so a stretch spans the steep segments it summarises.
		const endM = slice[Math.min(s.endIdx + 1, slice.length - 1)].distanceFromStart;
		const stretchFromKm = startM / 1000;
		const stretchToKm = endM / 1000;
		const lengthKm = stretchToKm - stretchFromKm;
		if (lengthKm < MIN_CRUX_STRETCH_KM) continue;
		const avgGradePct = s.sumAbs / s.count;
		const sac = hasRuns ? sacMaxForKmRange(runs as TrailOsmTagRun[], stretchFromKm, stretchToKm) : null;
		const stretch: ToughestStretch = {
			fromKm: stretchFromKm,
			toKm: stretchToKm,
			kind: s.sign >= 0 ? 'climb' : 'descent',
			avgGradePct,
			...(sac ? { sacClass: sac } : {}),
		};
		scored.push({ stretch, severity: lengthKm * avgGradePct });
	}

	scored.sort((a, b) => b.severity - a.severity);
	return scored.slice(0, maxN).map((x) => x.stretch);
}
