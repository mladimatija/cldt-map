import type { ClosestPoint, UnitSystem } from '@/lib/store/types';

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

const KM_TO_MILES = 1.60934;

/**
 * Computes ETA in seconds given a distance in metres and a walking pace in km/h.
 */
export function computeEta(distanceM: number, paceKmh: number): number {
	const distanceKm = distanceM / 1000;
	const hours = distanceKm / paceKmh;
	return Math.round(hours * 3600);
}

/**
 * Formats a duration in seconds as a human-readable ETA string.
 * Hours are omitted when < 1h. Always shows minutes.
 */
export function formatEta(seconds: number): string {
	const totalMinutes = Math.round(seconds / 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours === 0) {
		return `~${minutes}min`;
	}
	return `~${hours}h ${minutes}min`;
}

/**
 * Formats a walking pace in km/h as a display string in the given unit system.
 */
export function formatPace(paceKmh: number, units: UnitSystem): string {
	if (units === 'imperial') {
		const mph = paceKmh / KM_TO_MILES;
		return `${mph.toFixed(1)} mph`;
	}
	return `${paceKmh.toFixed(1)} km/h`;
}
