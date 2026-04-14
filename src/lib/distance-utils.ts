import type { ClosestPoint, TrailDirection, UnitSystem } from '@/lib/store/types';

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

export interface ElevationRemaining {
	gainM: number;
	lossM: number;
	sectionGainM: number | null;
	sectionLossM: number | null;
}

/**
 * Computes cumulative elevation gain and loss from the user's position to trail end (and
 * optionally to the active ruler section end), direction-aware.
 *
 * @param elevationPoints  Ordered elevation profile points for the trail.
 * @param fromIndex        Index of the point nearest to the user's current position.
 * @param direction        Travel direction: SOBO iterates forward, NOBO iterates backward.
 * @param rulerRange       Active ruler range (from map store), or null when ruler is inactive.
 * @param enhancedPoints   Full enhanced trail points carrying distanceFromStart values,
 *                         used to resolve the section end index from rulerRange.distanceFromStartB.
 */
export function computeElevationRemaining(
	elevationPoints: { elevation: number }[],
	fromIndex: number,
	direction: TrailDirection,
	rulerRange: { distanceFromStartA: number; distanceFromStartB: number } | null,
	enhancedPoints: { distanceFromStart: number }[],
): ElevationRemaining {
	if (elevationPoints.length === 0) {
		return { gainM: 0, lossM: 0, sectionGainM: null, sectionLossM: null };
	}

	const accumulateDeltas = (startIdx: number, endIdx: number): { gain: number; loss: number } => {
		let gain = 0;
		let loss = 0;
		for (let i = startIdx; i < endIdx; i++) {
			const delta = elevationPoints[i + 1].elevation - elevationPoints[i].elevation;
			if (delta > 0) {
				gain += delta;
			} else {
				loss += Math.abs(delta);
			}
		}
		return { gain, loss };
	};

	let gainM: number;
	let lossM: number;

	if (direction === 'SOBO') {
		const { gain, loss } = accumulateDeltas(fromIndex, elevationPoints.length - 1);
		gainM = gain;
		lossM = loss;
	} else {
		// NOBO: user is heading toward trail start — iterate backward
		let gain = 0;
		let loss = 0;
		for (let i = fromIndex; i > 0; i--) {
			const delta = elevationPoints[i - 1].elevation - elevationPoints[i].elevation;
			if (delta > 0) {
				gain += delta;
			} else {
				loss += Math.abs(delta);
			}
		}
		gainM = gain;
		lossM = loss;
	}

	if (rulerRange === null) {
		return { gainM, lossM, sectionGainM: null, sectionLossM: null };
	}

	// Find the index in enhancedPoints nearest to rulerRange.distanceFromStartB
	const targetDist = rulerRange.distanceFromStartB;
	let sectionEndIdx = 0;
	let minDiff = Math.abs(enhancedPoints[0].distanceFromStart - targetDist);
	for (let i = 1; i < enhancedPoints.length; i++) {
		const diff = Math.abs(enhancedPoints[i].distanceFromStart - targetDist);
		if (diff < minDiff) {
			minDiff = diff;
			sectionEndIdx = i;
		}
	}

	// Clamp sectionEndIdx to elevationPoints bounds
	const clampedSectionEnd = Math.min(sectionEndIdx, elevationPoints.length - 1);

	let sectionGainM: number;
	let sectionLossM: number;

	if (direction === 'SOBO') {
		const start = Math.min(fromIndex, clampedSectionEnd);
		const end = Math.max(fromIndex, clampedSectionEnd);
		const { gain, loss } = accumulateDeltas(start, end);
		sectionGainM = gain;
		sectionLossM = loss;
	} else {
		// NOBO section: from fromIndex backward to sectionEndIdx
		let gain = 0;
		let loss = 0;
		const start = Math.min(fromIndex, clampedSectionEnd);
		const end = Math.max(fromIndex, clampedSectionEnd);
		for (let i = end; i > start; i--) {
			const delta = elevationPoints[i - 1].elevation - elevationPoints[i].elevation;
			if (delta > 0) {
				gain += delta;
			} else {
				loss += Math.abs(delta);
			}
		}
		sectionGainM = gain;
		sectionLossM = loss;
	}

	return { gainM, lossM, sectionGainM, sectionLossM };
}
