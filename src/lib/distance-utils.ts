import type { ClosestPoint, TrailDirection, UnitSystem } from '@/lib/store/types';

export interface DistanceRemaining {
	traveled: number;
	toTrailEnd: number;
	toSectionEnd: number | null;
}

export interface RulerRange {
	distanceFromStartA: number;
	distanceFromStartB: number;
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
	rulerRange: RulerRange | null,
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

// --- Grade-adjusted ETA model constants ---
// Naismith's rule: 1 hour of extra time per 600 m of ascent → 6 s/m
export const NAISMITH_SEC_PER_M_CLIMB = 6;
// Tobler's hiking function peak-efficiency slope offset
export const TOBLER_OPTIMAL_SLOPE = 0.05;
// Normalization factor so that a flat (0%) grade produces a Tobler factor of exactly 1.0,
// preserving the user's configured pace as the flat-terrain baseline.
export const TOBLER_NORM = Math.exp(-3.5 * TOBLER_OPTIMAL_SLOPE);

/**
 * Per-segment time in seconds combining Tobler's hiking-function and Naismith's rule.
 *
 * The two models are intentionally additive:
 * - Tobler adjusts the time-to-traverse-distance component based on the slope.
 * - Naismith adds an independent climb-effort penalty on top.
 * On sustained ascents this produces a more conservative (realistic) ETA than
 * either model alone; on descents only Tobler applies.
 */
export function gradeSegmentSeconds(distSeg: number, dz: number, speedMps: number): number {
	const slope = dz / distSeg; // distSeg is always > 0 at call sites (guarded before calling)
	const toblerFactor = Math.exp(-3.5 * Math.abs(slope + TOBLER_OPTIMAL_SLOPE)) / TOBLER_NORM;
	const effectiveSpeedMps = speedMps * toblerFactor;
	const tFlat = effectiveSpeedMps > 0 ? distSeg / effectiveSpeedMps : 0;
	const tClimb = dz > 0 ? dz * NAISMITH_SEC_PER_M_CLIMB : 0;
	return tFlat + tClimb;
}

export interface ComputeEtaOptions {
	elevationPoints?: { elevation: number; distanceFromStart: number }[];
	fromIndex?: number;
	direction?: TrailDirection;
	gradeAdjusted?: boolean;
}

/**
 * Computes ETA in seconds given a distance in metres and a walking pace in km/h.
 *
 * When opts.gradeAdjusted is true and a valid elevation profile is supplied,
 * uses a Naismith + Tobler per-segment integration (see gradeSegmentSeconds).
 * Falls back to the flat-pace formula when the option is disabled or elevation
 * data is missing - existing callers that omit opts are unaffected.
 */
export function computeEta(distanceM: number, paceKmh: number, opts?: ComputeEtaOptions): number {
	// Fast path: flat-pace formula (original behavior, zero regression for existing callers)
	if (
		!opts ||
		!opts.gradeAdjusted ||
		!opts.elevationPoints ||
		opts.elevationPoints.length < 2 ||
		opts.fromIndex === undefined
	) {
		return Math.round((distanceM / 1000 / paceKmh) * 3600);
	}

	const { elevationPoints, fromIndex, direction = 'SOBO' } = opts;
	// Clamp fromIndex to a valid array position to prevent NaN propagation when arrays
	// are briefly out of sync (e.g. during a direction switch).
	const safeFromIndex = Math.max(0, Math.min(fromIndex, elevationPoints.length - 1));
	const speedMps = (paceKmh * 1000) / 3600;

	let totalSeconds = 0;
	let distAccum = 0;

	if (direction === 'SOBO') {
		for (let i = safeFromIndex; i < elevationPoints.length - 1; i++) {
			const distSeg = elevationPoints[i + 1].distanceFromStart - elevationPoints[i].distanceFromStart;
			if (distSeg <= 0) continue; // skip degenerate or reversed segments
			const dz = elevationPoints[i + 1].elevation - elevationPoints[i].elevation;
			if (distAccum + distSeg >= distanceM) {
				const fraction = (distanceM - distAccum) / distSeg;
				totalSeconds += gradeSegmentSeconds(distSeg * fraction, dz * fraction, speedMps);
				break;
			}
			totalSeconds += gradeSegmentSeconds(distSeg, dz, speedMps);
			distAccum += distSeg;
		}
	} else {
		// NOBO: walk backward toward index 0
		for (let i = safeFromIndex; i > 0; i--) {
			const distSeg = elevationPoints[i].distanceFromStart - elevationPoints[i - 1].distanceFromStart;
			if (distSeg <= 0) continue; // skip degenerate or reversed segments
			const dz = elevationPoints[i - 1].elevation - elevationPoints[i].elevation;
			if (distAccum + distSeg >= distanceM) {
				const fraction = (distanceM - distAccum) / distSeg;
				totalSeconds += gradeSegmentSeconds(distSeg * fraction, dz * fraction, speedMps);
				break;
			}
			totalSeconds += gradeSegmentSeconds(distSeg, dz, speedMps);
			distAccum += distSeg;
		}
	}

	return Math.round(totalSeconds);
}

/**
 * Finds the index of the point in a sorted array (ascending distanceFromStart) whose
 * distanceFromStart is nearest to targetM. Uses binary search - O(log n).
 * Returns 0 when the array is empty.
 */
export function findNearestPointIndex(points: { distanceFromStart: number }[], targetM: number): number {
	if (points.length === 0) return 0;
	if (points.length === 1) return 0;

	// Binary search for the insertion point of targetM.
	let lo = 0;
	let hi = points.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (points[mid].distanceFromStart < targetM) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	// lo is the first index where distanceFromStart >= targetM.
	// Compare it with the previous index to pick the nearest.
	if (
		lo > 0 &&
		Math.abs(points[lo - 1].distanceFromStart - targetM) <= Math.abs(points[lo].distanceFromStart - targetM)
	) {
		return lo - 1;
	}
	return lo;
}

export interface ProjectPositionAtTimeOpts {
	fromIndex: number;
	deltaSec: number;
	direction: TrailDirection;
	paceKmh: number;
	/** Elevation profile. Include lat/lng fields to receive interpolated coordinates in the result. */
	elevationPoints: { elevation: number; distanceFromStart: number; lat?: number; lng?: number }[];
	gradeAdjusted: boolean;
}

export interface ProjectedPosition {
	index: number;
	distanceM: number;
	elevationM: number;
	/** Interpolated latitude - present when elevationPoints carry lat/lng fields. */
	lat?: number;
	/** Interpolated longitude - present when elevationPoints carry lat/lng fields. */
	lng?: number;
}

/**
 * Projects the trail position reached after deltaSec seconds from fromIndex,
 * using flat pace or the grade-adjusted model (Naismith + Tobler).
 * Returns null for invalid inputs. Pins to trail end when time is exhausted.
 */
export function projectPositionAtTime(opts: ProjectPositionAtTimeOpts): ProjectedPosition | null {
	const { fromIndex, deltaSec, direction, paceKmh, elevationPoints, gradeAdjusted } = opts;
	if (deltaSec <= 0 || !Number.isFinite(fromIndex) || elevationPoints.length < 2) return null;

	const safeFromIndex = Math.max(0, Math.min(fromIndex, elevationPoints.length - 1));
	const speedMps = (paceKmh * 1000) / 3600;
	let accumulated = 0; // seconds
	let distAccum = 0; // metres

	if (direction === 'SOBO') {
		for (let i = safeFromIndex; i < elevationPoints.length - 1; i++) {
			const distSeg = elevationPoints[i + 1].distanceFromStart - elevationPoints[i].distanceFromStart;
			if (distSeg <= 0) continue;
			const dz = elevationPoints[i + 1].elevation - elevationPoints[i].elevation;
			const segSec = gradeAdjusted ? gradeSegmentSeconds(distSeg, dz, speedMps) : distSeg / speedMps;
			if (accumulated + segSec >= deltaSec) {
				const fraction = (deltaSec - accumulated) / segSec;
				const a = elevationPoints[i];
				const b = elevationPoints[i + 1];
				return {
					index: i + 1,
					distanceM: distAccum + distSeg * fraction,
					elevationM: a.elevation + dz * fraction,
					lat: a.lat !== undefined && b.lat !== undefined ? a.lat + (b.lat - a.lat) * fraction : undefined,
					lng: a.lng !== undefined && b.lng !== undefined ? a.lng + (b.lng - a.lng) * fraction : undefined,
				};
			}
			accumulated += segSec;
			distAccum += distSeg;
		}
		// Pinned to trail end - distanceM is distance walked from fromIndex (not from trail start)
		const last = elevationPoints.length - 1;
		return {
			index: last,
			distanceM: distAccum,
			elevationM: elevationPoints[last].elevation,
			lat: elevationPoints[last].lat,
			lng: elevationPoints[last].lng,
		};
	} else {
		for (let i = safeFromIndex; i > 0; i--) {
			const distSeg = elevationPoints[i].distanceFromStart - elevationPoints[i - 1].distanceFromStart;
			if (distSeg <= 0) continue;
			const dz = elevationPoints[i - 1].elevation - elevationPoints[i].elevation;
			const segSec = gradeAdjusted ? gradeSegmentSeconds(distSeg, dz, speedMps) : distSeg / speedMps;
			if (accumulated + segSec >= deltaSec) {
				const fraction = (deltaSec - accumulated) / segSec;
				const a = elevationPoints[i];
				const b = elevationPoints[i - 1];
				return {
					index: i - 1,
					distanceM: distAccum + distSeg * fraction,
					elevationM: a.elevation + dz * fraction,
					lat: a.lat !== undefined && b.lat !== undefined ? a.lat + (b.lat - a.lat) * fraction : undefined,
					lng: a.lng !== undefined && b.lng !== undefined ? a.lng + (b.lng - a.lng) * fraction : undefined,
				};
			}
			accumulated += segSec;
			distAccum += distSeg;
		}
		// Pinned to trail start - distanceM is distance walked from fromIndex
		return {
			index: 0,
			distanceM: distAccum,
			elevationM: elevationPoints[0].elevation,
			lat: elevationPoints[0].lat,
			lng: elevationPoints[0].lng,
		};
	}
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

export function formatDistanceM(meters: number, units: UnitSystem): string {
	if (units === 'imperial') {
		return `${(meters / 1609.344).toFixed(1)} mi`;
	}
	return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Computes the initial great-circle bearing (in degrees, 0-360, clockwise from north)
 * from point 1 to point 2. Uses the spherical "forward azimuth" formula.
 */
export function computeBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const φ1 = (lat1 * Math.PI) / 180;
	const φ2 = (lat2 * Math.PI) / 180;
	const Δλ = ((lng2 - lng1) * Math.PI) / 180;
	const y = Math.sin(Δλ) * Math.cos(φ2);
	const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
	return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Returns the angular offset of the wind source relative to the trail bearing,
 * in the range (-180, 180]. Both inputs are degrees clockwise from north.
 * `windFromDeg` is the meteorological "wind from" direction (Open-Meteo's
 * `winddirection_10m`): the direction the wind is blowing FROM.
 *
 * - 0 means the wind comes from the direction of travel (head-on → headwind).
 * - ±180 means the wind comes from behind the hiker (→ tailwind).
 * - ±90 means a pure crosswind from the right (-90) or left (+90).
 *
 * The output is the rotation to apply to the compass arrow so that it points
 * toward the wind's source while the trail bearing is fixed pointing up.
 */
export function relativeWindAngle(windFromDeg: number, trailBearingDeg: number): number {
	return ((windFromDeg - trailBearingDeg + 540) % 360) - 180;
}

export type WindClass = 'tailwind' | 'crosswind' | 'headwind';

/**
 * Classifies a relative-wind angle (output of `relativeWindAngle`) into
 * headwind / crosswind / tailwind. Because the angle measures wind-source
 * relative to travel direction, small angles mean the wind comes from where
 * the hiker is heading (headwind); large angles mean it comes from behind
 * (tailwind).
 */
export function classifyWind(relativeAngle: number): WindClass {
	const a = Math.abs(relativeAngle);
	if (a <= 45) return 'headwind';
	if (a >= 135) return 'tailwind';
	return 'crosswind';
}

/** Wind speeds below this (km/h) are treated as calm and the compass is hidden. */
export const CALM_WIND_THRESHOLD_KMH = 3;

/**
 * Computes the wind-vs-bearing payload for a tooltip compass. Returns `null`
 * when the compass should be hidden - calm conditions or missing wind direction.
 * Callers format the visible label themselves (i18n lives at the call site).
 */
export function buildWindCompassPayload(
	windFromDeg: number | null,
	windspeedKmh: number,
	trailBearingDeg: number,
): { relativeAngle: number; cls: WindClass } | null {
	if (windFromDeg === null || windspeedKmh < CALM_WIND_THRESHOLD_KMH) return null;
	const relativeAngle = relativeWindAngle(windFromDeg, trailBearingDeg);
	return { relativeAngle, cls: classifyWind(relativeAngle) };
}

function formatMinSec(totalSec: number, unit: string): string {
	const min = Math.floor(totalSec / 60);
	const sec = Math.round(totalSec % 60);
	return `${min}:${sec.toString().padStart(2, '0')}/${unit}`;
}

export function formatPaceFromSecPerKm(secPerKm: number, units: UnitSystem): string {
	if (secPerKm === 0) return '-';
	return units === 'imperial' ? formatMinSec(secPerKm * 1.60934, 'mi') : formatMinSec(secPerKm, 'km');
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
	rulerRange: RulerRange | null,
	enhancedPoints: { distanceFromStart: number }[],
): ElevationRemaining {
	if (elevationPoints.length === 0) {
		return { gainM: 0, lossM: 0, sectionGainM: null, sectionLossM: null };
	}

	// reverse=false: iterate i from startIdx to endIdx-1, delta = [i+1] - [i]
	// reverse=true:  iterate i from endIdx down to startIdx+1, delta = [i-1] - [i]
	const accumulateDeltas = (startIdx: number, endIdx: number, reverse = false): { gain: number; loss: number } => {
		let gain = 0;
		let loss = 0;
		if (reverse) {
			for (let i = endIdx; i > startIdx; i--) {
				const delta = elevationPoints[i - 1].elevation - elevationPoints[i].elevation;
				if (delta > 0) gain += delta;
				else loss += Math.abs(delta);
			}
		} else {
			for (let i = startIdx; i < endIdx; i++) {
				const delta = elevationPoints[i + 1].elevation - elevationPoints[i].elevation;
				if (delta > 0) gain += delta;
				else loss += Math.abs(delta);
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
		// NOBO: user is heading toward trail start - iterate backward
		const { gain, loss } = accumulateDeltas(0, fromIndex, true);
		gainM = gain;
		lossM = loss;
	}

	if (rulerRange === null) {
		return { gainM, lossM, sectionGainM: null, sectionLossM: null };
	}

	// Find the index in enhancedPoints nearest to rulerRange.distanceFromStartB
	const sectionEndIdx = findNearestPointIndex(enhancedPoints, rulerRange.distanceFromStartB);

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
		// NOBO section: accumulate backward between the two boundary indices
		const start = Math.min(fromIndex, clampedSectionEnd);
		const end = Math.max(fromIndex, clampedSectionEnd);
		const { gain, loss } = accumulateDeltas(start, end, true);
		sectionGainM = gain;
		sectionLossM = loss;
	}

	return { gainM, lossM, sectionGainM, sectionLossM };
}
