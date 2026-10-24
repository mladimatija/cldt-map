/**
 * Trail distance frames, and the only place that converts between them.
 *
 * SOBO frame: metres (or km) from Ilok along the GPX in file order. Every
 * computed and stored trail distance uses it: enhancedTrailPoints,
 * closestPoint, rulerRange, POI / seasonal / OSM-tag / junction / section km,
 * completion intervals, stage plans, journal entries and waypoints. The trail
 * arrays are the same in both directions.
 *
 * Travel frame: metres (or km) from the hiker's start in the current
 * direction. It appears only at the edges: labels, user inputs and share-link
 * parameters (kept travel-relative for backward compatibility).
 */
import type { EnhancedTrailPoint, TrailDirection } from './store/types';

/** SOBO km to the km a hiker travelling in `direction` has covered. */
export function toTravelKm(soboKm: number, direction: TrailDirection, totalKm: number): number {
	return direction === 'NOBO' ? Math.max(0, totalKm - soboKm) : soboKm;
}

/** Travel km (as shown or typed) back to SOBO km. */
export function toSoboKm(travelKm: number, direction: TrailDirection, totalKm: number): number {
	return direction === 'NOBO' ? Math.max(0, totalKm - travelKm) : travelKm;
}

/** Metre variant of toTravelKm. */
export function toTravelM(soboM: number, direction: TrailDirection, totalM: number): number {
	return toTravelKm(soboM, direction, totalM);
}

/** Metre variant of toSoboKm. */
export function toSoboM(travelM: number, direction: TrailDirection, totalM: number): number {
	return toSoboKm(travelM, direction, totalM);
}

/** A SOBO range (either order, km or metres) as the hiker meets it: travel units, start first. */
export function toTravelRange(
	aSobo: number,
	bSobo: number,
	direction: TrailDirection,
	total: number,
): { from: number; to: number } {
	const a = toTravelKm(aSobo, direction, total);
	const b = toTravelKm(bSobo, direction, total);
	return { from: Math.min(a, b), to: Math.max(a, b) };
}

/** A travel range (either order, km or metres) back to a SOBO range, low end first. */
export function toSoboRange(
	aTravel: number,
	bTravel: number,
	direction: TrailDirection,
	total: number,
): { from: number; to: number } {
	const a = toSoboKm(aTravel, direction, total);
	const b = toSoboKm(bTravel, direction, total);
	return { from: Math.min(a, b), to: Math.max(a, b) };
}

/** Metres still to go from a SOBO position to the travel end. */
export function remainingM(soboM: number, direction: TrailDirection, totalM: number): number {
	return direction === 'NOBO' ? Math.max(0, soboM) : Math.max(0, totalM - soboM);
}

/** Index of the hiker's start point in a SOBO-ordered array. */
export function travelStartIndex(points: readonly unknown[], direction: TrailDirection): number {
	return direction === 'NOBO' ? Math.max(0, points.length - 1) : 0;
}

/** Index of the hiker's finish point in a SOBO-ordered array. */
export function travelEndIndex(points: readonly unknown[], direction: TrailDirection): number {
	return direction === 'NOBO' ? 0 : Math.max(0, points.length - 1);
}

/** Grade of the segment starting at `point` (in file order), signed for the
 *  travel direction: positive is uphill for the hiker. */
export function travelGradePct(point: Pick<EnhancedTrailPoint, 'gradePct'>, direction: TrailDirection): number {
	return direction === 'NOBO' ? -point.gradePct : point.gradePct;
}

/** Bearing the hiker faces at `index` when walking in `direction`. Each point
 *  stores the SOBO bearing to the next point, so NOBO turns the previous
 *  point's bearing around. */
export function travelBearingDeg(
	points: readonly Pick<EnhancedTrailPoint, 'bearingDeg'>[],
	index: number,
	direction: TrailDirection,
): number {
	if (direction === 'SOBO') return points[index]?.bearingDeg ?? 0;
	const prev = points[Math.max(0, index - 1)];
	return ((prev?.bearingDeg ?? 0) + 180) % 360;
}

/** Climb and descent from the hiker's start to `point`. The stored cumulative
 *  values run from Ilok, so NOBO reads them from the other end: a SOBO
 *  descent after the point is a NOBO climb before it. */
export function travelGainLossSoFar(
	point: Pick<EnhancedTrailPoint, 'elevationGainFromStart' | 'elevationLossFromStart'>,
	direction: TrailDirection,
	totals: { gain: number; loss: number },
): { gain: number; loss: number } {
	if (direction === 'SOBO') return { gain: point.elevationGainFromStart, loss: point.elevationLossFromStart };
	return {
		gain: Math.max(0, totals.loss - point.elevationLossFromStart),
		loss: Math.max(0, totals.gain - point.elevationGainFromStart),
	};
}

/** Climb and descent of a stretch measured in file order, as walked in
 *  `direction`: a SOBO climb is a NOBO descent. */
export function travelGainLoss(
	soboGain: number,
	soboLoss: number,
	direction: TrailDirection,
): { gain: number; loss: number } {
	return direction === 'NOBO' ? { gain: soboLoss, loss: soboGain } : { gain: soboGain, loss: soboLoss };
}

/** Climb and descent between two SOBO points (either order), as walked in
 *  `direction`. */
export function segmentGainLoss(
	a: Pick<EnhancedTrailPoint, 'distanceFromStart' | 'elevationGainFromStart' | 'elevationLossFromStart'>,
	b: Pick<EnhancedTrailPoint, 'distanceFromStart' | 'elevationGainFromStart' | 'elevationLossFromStart'>,
	direction: TrailDirection,
): { gain: number; loss: number } {
	const [from, to] = a.distanceFromStart <= b.distanceFromStart ? [a, b] : [b, a];
	return travelGainLoss(
		Math.max(0, to.elevationGainFromStart - from.elevationGainFromStart),
		Math.max(0, to.elevationLossFromStart - from.elevationLossFromStart),
		direction,
	);
}
