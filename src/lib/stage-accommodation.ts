/**
 * Stage-end accommodation anchoring.
 *
 * The multi-day planner splits the trail purely by distance / ETA, which never
 * answers the most useful planning question of all: "where do I actually sleep
 * at the end of this day?" This helper finds, for a given stage-boundary km,
 * the nearest place a hiker can realistically spend the night - a mountain hut
 * or shelter (purpose-built overnight stops) or a town / settlement (lodging
 * or camping) - within a small along-trail window.
 *
 * Pure and offline: it reads the already-loaded POI dataset, so it adds no
 * network and no new data source. Like the dry-stretch stat, the planner feeds
 * it the full POI list rather than the layer-visibility-filtered subset, so
 * hiding hut markers on the map never hides the "where to sleep" answer.
 */

import { STAGE_POI_OFFTRAIL_KM, type Poi } from './poi-types';

/** POI types that count as a place to spend the night. */
export const OVERNIGHT_POI_TYPES = ['hut', 'shelter', 'town', 'settlement'] as const;

const OVERNIGHT_SET = new Set<string>(OVERNIGHT_POI_TYPES);

/** Default along-trail search window (km) on each side of the stage boundary.
 *  Beyond this, there is effectively no overnight option at the stage end. */
export const STAGE_ACCOMMODATION_WINDOW_KM = 8;

/** Huts and shelters are purpose-built overnight stops; prefer one over a town
 *  at a similar along-trail distance by discounting its effective distance. */
const PURPOSE_BUILT_BONUS_KM = 1.5;

export interface StageEndAccommodation {
	poi: Poi;
	/** Signed along-trail offset from the stage boundary, km (SOBO-keyed):
	 *  negative = the place lies before the boundary (stop a little short),
	 *  positive = past it (push a little further), ~0 = right at the end. */
	alongKm: number;
	/** Off-trail walk-in distance from the route, km. */
	offTrailKm: number;
}

function isPurposeBuilt(type: string): boolean {
	return type === 'hut' || type === 'shelter';
}

/** Pre-filters the dataset to overnight-type POIs within the off-trail cap, once,
 *  so the planner can scan a small array per stage instead of the full ~4k rows
 *  (mirrors how `waterSourceKms` pre-reduces water POIs for the dry-stretch stat). */
export function filterOvernightCandidates(pois: readonly Poi[], offTrailKm: number = STAGE_POI_OFFTRAIL_KM): Poi[] {
	return pois.filter((p) => OVERNIGHT_SET.has(p.type) && p.distanceFromTrailKm <= offTrailKm);
}

/**
 * Finds the nearest viable overnight POI to a stage-boundary km. Candidates are
 * overnight-type POIs within `windowKm` along the trail and within `offTrailKm`
 * of the route; the winner minimises along-trail distance plus off-trail walk,
 * with a bonus that favours a hut/shelter over a town at a comparable distance.
 * Returns null when nothing viable sits near the boundary.
 */
export function findStageEndAccommodation(
	endKm: number,
	pois: readonly Poi[],
	opts?: { windowKm?: number; offTrailKm?: number },
): StageEndAccommodation | null {
	const windowKm = opts?.windowKm ?? STAGE_ACCOMMODATION_WINDOW_KM;
	const offCap = opts?.offTrailKm ?? STAGE_POI_OFFTRAIL_KM;
	let best: StageEndAccommodation | null = null;
	let bestScore = Infinity;
	for (const poi of pois) {
		if (!OVERNIGHT_SET.has(poi.type)) continue;
		if (poi.distanceFromTrailKm > offCap) continue;
		const alongKm = poi.trailKm - endKm;
		if (Math.abs(alongKm) > windowKm) continue;
		const score = Math.abs(alongKm) + poi.distanceFromTrailKm - (isPurposeBuilt(poi.type) ? PURPOSE_BUILT_BONUS_KM : 0);
		if (score < bestScore) {
			bestScore = score;
			best = { poi, alongKm, offTrailKm: poi.distanceFromTrailKm };
		}
	}
	return best;
}
