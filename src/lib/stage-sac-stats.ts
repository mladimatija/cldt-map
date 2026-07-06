import { rangeOverlapKm, SAC_SCALE_ORDER, type SacScale, type TrailOsmTagRun } from '@/lib/trail-osm-tags';

/**
 * Per-stage SAC hiking-scale breakdown for the multi-day planner. Promotes the
 * OSM sac_scale tag dataset (loaded lazily onto `trailOsmTagsFile`) into planning
 * stats: km per class over a stage's km window, the hardest class present, and a
 * gate for "demanding" (T3+) terrain. Overlap math mirrors
 * computeSurfaceBreakdownBySection so the clamp-and-subtract logic stays in one
 * place (rangeOverlapKm). Everything degrades to empty/null when SAC data is
 * absent, so the planner UI hides the terrain stats rather than lying.
 */

/**
 * Minimum km of T3+ (demanding_mountain_hiking or harder) terrain within a stage
 * before the per-stage terrain chip is worth showing. Keeps the ~211 km of T1/T2
 * from ever firing the chip and filters short mis-tags, so the chip only lands on
 * the genuinely demanding Velebit / Paklenica days.
 */
export const SAC_DEMANDING_MIN_KM = 1;

/** Rank of the easiest "demanding" class (T3). Classes at or above this rank
 *  count toward the demanding-terrain gate. */
const DEMANDING_MIN_RANK = SAC_SCALE_ORDER.indexOf('demanding_mountain_hiking');

export interface StageSacBreakdown {
	/** km per SAC class overlapping [fromKm, toKm]; only classes with > 0 km appear. */
	kmByClass: Partial<Record<SacScale, number>>;
	/** Total tagged km (sum over kmByClass). 0 when no overlapping run carries a sac_scale tag. */
	taggedKm: number;
	/** Hardest SAC class present over the range (by SAC_SCALE_ORDER), or null when untagged. */
	hardestClass: SacScale | null;
	/** km of the hardest class within the range. */
	hardestKm: number;
	/** km of T3+ (demanding_mountain_hiking or harder) within the range. */
	demandingKm: number;
}

/**
 * Sum tagged SAC-class km over [fromKm, toKm] (SOBO km, order-independent - the
 * OSM runs share that frame). Returns per-class km, the hardest class present,
 * and the demanding (T3+) km used to gate the terrain chip.
 */
export function computeStageSacBreakdown(
	runs: readonly TrailOsmTagRun[],
	fromKm: number,
	toKm: number,
): StageSacBreakdown {
	const lo = Math.min(fromKm, toKm);
	const hi = Math.max(fromKm, toKm);
	const kmByClass: Partial<Record<SacScale, number>> = {};
	let taggedKm = 0;
	let demandingKm = 0;
	for (const run of runs) {
		if (!run.sac_scale) continue;
		if (run.toKm <= run.fromKm) continue;
		const overlap = rangeOverlapKm(run.fromKm, run.toKm, lo, hi);
		if (overlap <= 0) continue;
		kmByClass[run.sac_scale] = (kmByClass[run.sac_scale] ?? 0) + overlap;
		taggedKm += overlap;
		if (SAC_SCALE_ORDER.indexOf(run.sac_scale) >= DEMANDING_MIN_RANK) demandingKm += overlap;
	}
	let hardestClass: SacScale | null = null;
	let hardestRank = -1;
	for (const cls of Object.keys(kmByClass) as SacScale[]) {
		const rank = SAC_SCALE_ORDER.indexOf(cls);
		if (rank > hardestRank) {
			hardestRank = rank;
			hardestClass = cls;
		}
	}
	const hardestKm = hardestClass ? (kmByClass[hardestClass] ?? 0) : 0;
	return { kmByClass, taggedKm, hardestClass, hardestKm, demandingKm };
}

/**
 * True when the stage holds at least SAC_DEMANDING_MIN_KM of T3+ terrain - the
 * gate for surfacing the per-stage terrain difficulty chip.
 */
export function hasDemandingSacTerrain(breakdown: StageSacBreakdown | null | undefined): boolean {
	return !!breakdown && breakdown.demandingKm >= SAC_DEMANDING_MIN_KM;
}
