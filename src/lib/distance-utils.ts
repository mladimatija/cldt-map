import type { ClosestPoint } from '@/lib/store/types';

export interface DistanceRemaining {
	traveled: number;
	toTrailEnd: number;
	toSectionEnd: number | null;
}

/**
 * Derives the three distance display values from the user's current closest trail point.
 *
 * @param closestPoint  The closest point on the trail to the user's location, or null if unknown.
 * @param rulerRange    Active ruler range (from map store), or null when ruler is inactive.
 * @param onTrailThresholdM  Maximum distance in metres before the user is considered off-trail.
 * @returns null when the user is off-trail or closestPoint is unavailable.
 */
export function computeDistanceRemaining(
	closestPoint: ClosestPoint | null,
	rulerRange: { distanceFromStartA: number; distanceFromStartB: number } | null,
	onTrailThresholdM: number,
): DistanceRemaining | null {
	if (closestPoint === null) {
		return null;
	}

	if (closestPoint.distance > onTrailThresholdM) {
		return null;
	}

	const traveled = closestPoint.distanceFromStart;
	const toTrailEnd = closestPoint.distanceToEnd;
	const toSectionEnd = rulerRange ? Math.max(0, rulerRange.distanceFromStartB - closestPoint.distanceFromStart) : null;

	return { traveled, toTrailEnd, toSectionEnd };
}
