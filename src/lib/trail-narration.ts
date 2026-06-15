/**
 * Pure helpers for the accessibility trail narration (keyboard scrubber + live
 * region). Kept free of React / next-intl so they stay testable and reusable;
 * the component supplies localized strings and does the formatting.
 */
import { poiAheadKm } from '@/lib/poi-ahead-corridor';
import { isUsableWaterSource } from '@/lib/water-intelligence';
import type { Poi } from '@/lib/pois';
import type { TrailDirection } from '@/lib/types';

export type GradeWord = 'climbing' | 'descending' | 'flat';

/** Forward look-ahead (km) for the "water ahead" safety announcement. */
export const WATER_AHEAD_HORIZON_KM = 5;

/**
 * Climbing / descending / flat from the signed grade. gradePct is positive when
 * ascending in the current travel direction (see EnhancedTrailPoint), so this is
 * direction-correct without extra handling. A +/-1% dead band reads as flat.
 */
export function gradeWord(gradePct: number): GradeWord {
	if (gradePct > 1) return 'climbing';
	if (gradePct < -1) return 'descending';
	return 'flat';
}

/**
 * Distance (km) to the nearest usable water source ahead of `soboKm` in the
 * travel direction, within `horizonKm`, or null when there is none. Reuses the
 * same reliability test and direction math as the rest of the app.
 */
export function nearestUsableWaterAheadKm(
	soboKm: number,
	pois: readonly Poi[] | undefined,
	direction: TrailDirection,
	horizonKm: number = WATER_AHEAD_HORIZON_KM,
): number | null {
	if (!pois?.length) return null;
	let best: number | null = null;
	for (const poi of pois) {
		if (poi.type !== 'water' || !isUsableWaterSource(poi.water)) continue;
		const ahead = poiAheadKm(poi.trailKm, soboKm, direction);
		if (ahead === null || ahead <= 0 || ahead > horizonKm) continue;
		if (best === null || ahead < best) best = ahead;
	}
	return best;
}
