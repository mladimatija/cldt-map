import type { LatLng } from 'leaflet';
import type { StateCreator } from 'zustand';
import { config } from '../config';
import { isWithinMapBoundary } from '../utils';
import type { StoreState, TrailSlice, TrailState, ClosestPoint, EnhancedTrailPoint } from './types';
import { L } from './leaflet';
import { TRAIL_SECTIONS } from '../trail-sections';
import { computeBearing, findNearestPointIndex } from '../distance-utils';
import { buildSpatialGrid, type SpatialGrid } from '../spatial-grid';

/** Bucket an absolute grade percent into one of five bands. */
function bucketGradePct(absGradePct: number): 0 | 1 | 2 | 3 | 4 {
	if (absGradePct <= 3) return 0;
	if (absGradePct <= 6) return 1;
	if (absGradePct <= 10) return 2;
	if (absGradePct <= 15) return 3;
	return 4;
}

/**
 * Find the index of the trail point closest to (targetLat, targetLng) by raw
 * squared lat/lng delta. No allocations, no sqrt - the metric distance must be
 * computed separately on the returned index if needed. Returns 0 for empty input.
 */
function nearestIndexByCoords(points: { lat: number; lng: number }[], targetLat: number, targetLng: number): number {
	let closestIndex = 0;
	let closestSq = Infinity;
	for (let i = 0; i < points.length; i++) {
		const dlat = points[i].lat - targetLat;
		const dlng = points[i].lng - targetLng;
		const d2 = dlat * dlat + dlng * dlng;
		if (d2 < closestSq) {
			closestSq = d2;
			closestIndex = i;
		}
	}
	return closestIndex;
}

/**
 * Compute the closest point on the trail to a given location. Pure helper
 * used by calculateClosestPoint and forceCalculateClosestPointFromLocation.
 *
 * setUserLocation resets closestPointCalculated, so this runs on EVERY GPS
 * fix. The previous linear nearest-index scan walked the full ~2,200 km
 * point array per tick; a spatial grid (built once per trail array, cached
 * by array identity so a reload or direction rebuild naturally invalidates)
 * makes the per-tick lookup near-constant.
 */
const trailGridCache = new WeakMap<LatLng[], SpatialGrid>();

function computeClosestPointData(
	points: LatLng[],
	enhancedPoints: EnhancedTrailPoint[],
	totalDistanceM: number,
	userLatLng: LatLng,
): ClosestPoint | null {
	if (points.length === 0) return null;

	let grid = trailGridCache.get(points);
	if (!grid) {
		grid = buildSpatialGrid(points);
		trailGridCache.set(points, grid);
	}
	const hit = grid.nearest(userLatLng.lat, userLatLng.lng);
	const closestIndex = hit ? hit.index : nearestIndexByCoords(points, userLatLng.lat, userLatLng.lng);
	const closestPoint = points[closestIndex];
	const closestDistance = userLatLng.distanceTo(closestPoint);
	const enhanced = enhancedPoints[closestIndex];
	const distanceFromStart = enhanced?.distanceFromStart ?? 0;
	const distanceToEnd = Math.max(0, totalDistanceM - distanceFromStart);
	const elevationGainSoFar = enhanced?.elevationGainFromStart ?? 0;

	return {
		point: closestPoint,
		distance: closestDistance,
		distanceFromStart,
		distanceToEnd,
		elevationGainSoFar,
	};
}

/** Initial trail state for slice and SSR stub. */
export const INITIAL_TRAIL_STATE: TrailState = {
	trailPoints: [],
	enhancedTrailPoints: [],
	highlightedTrailPoint: null,
	tooltipPinnedFromShare: false,
	boundaryInitialized: false,
	gpxLoaded: false,
	gpxLoadFailed: false,
	closestPointCalculated: false,
	showClosestPointLine: false,
	closestPoint: null,
	trailMetadata: {
		startPoint: null,
		endPoint: null,
		totalDistance: 0,
		elevationGain: 0,
		elevationLoss: 0,
	},
	rawGpxData: null,
	gpxElevationPoints: null,
	direction: config.direction,
};

export const createTrailSlice: StateCreator<StoreState, [], [], TrailSlice> = (set, get) => ({
	...INITIAL_TRAIL_STATE,

	setTrailPoints: (points) => set({ trailPoints: points }),
	setEnhancedTrailPoints: (points) => set({ enhancedTrailPoints: points }),
	setHighlightedTrailPoint: (point) => set({ highlightedTrailPoint: point }),
	setBoundaryInitialized: (initialized) => set({ boundaryInitialized: initialized }),
	setGpxLoaded: (loaded) => set({ gpxLoaded: loaded }),
	setGpxLoadFailed: (failed) => set({ gpxLoadFailed: failed }),
	setClosestPointCalculated: (calculated) => set({ closestPointCalculated: calculated }),
	setShowClosestPointLine: (show) => set({ showClosestPointLine: show }),
	setClosestPoint: (point) => set({ closestPoint: point }),
	setTrailMetadata: (metadata) => set({ trailMetadata: metadata }),
	setRawGpxData: (data) => set({ rawGpxData: data }),
	setGpxElevationPoints: (points) => set({ gpxElevationPoints: points }),
	setDirection: (direction) => set({ direction }),

	calculateClosestPoint: (): void => {
		const state = get();

		if (state.closestPointCalculated) {
			return;
		}

		if (!state.userLocation || !state.trailPoints.length || !state.gpxLoaded) {
			return;
		}

		if (!isWithinMapBoundary(state.userLocation.lat, state.userLocation.lng)) {
			set({ closestPoint: null, closestPointCalculated: true, showClosestPointLine: false });
			return;
		}

		if (typeof L === 'undefined') {
			return;
		}
		const userLatLng = L.latLng(state.userLocation.lat, state.userLocation.lng);
		const totalDistanceM = (state.trailMetadata?.totalDistance ?? 0) * 1000;
		const closestPointData = computeClosestPointData(
			state.trailPoints,
			state.enhancedTrailPoints,
			totalDistanceM,
			userLatLng,
		);
		if (closestPointData) {
			// Publish suppression: every GPS fix resets closestPointCalculated,
			// so this runs per tick even when the hiker is standing still and
			// the fix only jitters by a few meters. A fresh object here would
			// re-render every closestPoint subscriber (HUD, sunset projection,
			// off-route machinery, tooltips) for a visually identical state.
			// Re-publish only when the snapped trail position moved or the
			// off-trail distance changed by >= 5 m - far below anything the
			// UI displays (0.1 km formatting) or thresholds on (200 m).
			const prev = state.closestPoint;
			const unchanged =
				prev !== null &&
				prev.distanceFromStart === closestPointData.distanceFromStart &&
				Math.abs(prev.distance - closestPointData.distance) < 5;
			if (unchanged) {
				set({ closestPointCalculated: true });
				return;
			}
			set({
				closestPoint: closestPointData,
				closestPointCalculated: true,
			});
			set({ showClosestPointLine: closestPointData.distance < 10000 });
		}
	},

	forceCalculateClosestPointFromLocation: (location): void => {
		const state = get();
		if (!state.gpxLoaded || typeof L === 'undefined') {
			return;
		}
		if (!isWithinMapBoundary(location.lat, location.lng)) {
			set({ closestPoint: null, closestPointCalculated: true, showClosestPointLine: false });
			return;
		}
		const points =
			state.trailPoints.length > 0
				? state.trailPoints
				: (state.enhancedTrailPoints ?? []).map((p) => L.latLng(p.lat, p.lng));
		if (!points.length) {
			return;
		}
		const userLatLng = L.latLng(location.lat, location.lng);
		const totalDistanceM = (state.trailMetadata?.totalDistance ?? 0) * 1000;
		const closestPointData = computeClosestPointData(points, state.enhancedTrailPoints, totalDistanceM, userLatLng);
		if (closestPointData) {
			set({
				closestPoint: closestPointData,
				closestPointCalculated: true,
				showClosestPointLine: closestPointData.distance < 10000,
			});
		}
	},

	broadcastDirectionChange: (newDirection): void => {
		set({ direction: newDirection });

		const event = new CustomEvent('directionChange', {
			detail: { direction: newDirection },
		});
		window.dispatchEvent(event);
	},

	// Caller is expected to pass `points` and `elevationPoints` already direction-adjusted
	// (ascending index = advancing in current travel direction). The raw elevation delta to the
	// next point therefore yields a direction-relative gradePct: positive = ascent in the current direction.
	processTrailData: (points, elevationPoints, startPoint, endPoint, distance, elevGain, elevLoss): void => {
		set({
			trailPoints: points,
			closestPoint: null,
			closestPointCalculated: false,
			showClosestPointLine: false,
			trailMetadata: {
				startPoint,
				endPoint,
				totalDistance: distance,
				elevationGain: elevGain,
				elevationLoss: elevLoss,
			},
			gpxElevationPoints: elevationPoints,
			gpxLoaded: true,
		});

		const enhancedPoints: EnhancedTrailPoint[] = [];
		let cumulativeDistance = 0;
		let cumulativeElevGain = 0;
		let cumulativeElevLoss = 0;

		for (let i = 0; i < points.length; i++) {
			if (i > 0) {
				cumulativeDistance += points[i - 1].distanceTo(points[i]);
			}

			if (i > 0 && elevationPoints?.[i] && elevationPoints?.[i - 1]) {
				const elevDiff = elevationPoints[i].elevation - elevationPoints[i - 1].elevation;
				if (elevDiff > 0) {
					cumulativeElevGain += elevDiff;
				} else {
					cumulativeElevLoss += Math.abs(elevDiff);
				}
			}

			const distKm = cumulativeDistance / 1000;
			const section = TRAIL_SECTIONS.find((s) => distKm >= s.startKm && distKm < s.endKm);

			// Bearing to the next point; last point's value is overwritten in a final pass below
			// (single-point trails keep 0).
			const bearingDeg =
				i < points.length - 1 ? computeBearing(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng) : 0;

			// Signed grade percent to the next point (positive = ascending in current direction).
			let gradePct = 0;
			if (i < points.length - 1 && elevationPoints?.[i] && elevationPoints?.[i + 1]) {
				const dEle = elevationPoints[i + 1].elevation - elevationPoints[i].elevation;
				const dDist = points[i].distanceTo(points[i + 1]);
				gradePct = dDist > 0 ? (dEle / dDist) * 100 : 0;
			}
			const gradeBand = bucketGradePct(Math.abs(gradePct));

			enhancedPoints.push({
				lat: points[i].lat,
				lng: points[i].lng,
				elevation: elevationPoints?.[i]?.elevation || 0,
				distanceFromStart: cumulativeDistance,
				elevationGainFromStart: cumulativeElevGain,
				elevationLossFromStart: cumulativeElevLoss,
				index: i,
				sectionName: section?.nameKey,
				bearingDeg,
				gradePct,
				gradeBand,
			});
		}

		// Last point inherits previous bearing/grade (single-point trails keep zeros).
		if (enhancedPoints.length >= 2) {
			const last = enhancedPoints[enhancedPoints.length - 1];
			const prev = enhancedPoints[enhancedPoints.length - 2];
			last.bearingDeg = prev.bearingDeg;
			last.gradePct = prev.gradePct;
			last.gradeBand = prev.gradeBand;
		}

		set({ enhancedTrailPoints: enhancedPoints });

		// Recalculate immediately to avoid 500ms window where closestPoint is null (causes tooltip flicker).
		get().calculateClosestPoint();
	},

	applyComputedTrailData: (data): void => {
		if (typeof L === 'undefined') return;
		// The only main-thread cost left: materialise Leaflet LatLng instances
		// (closest-point consumers call .distanceTo on trailPoints). Enhanced
		// points are plain objects and transfer straight from the worker.
		const latLngPoints = data.points.map((p) => L.latLng(p.lat, p.lng));
		set({
			trailPoints: latLngPoints,
			closestPoint: null,
			closestPointCalculated: false,
			showClosestPointLine: false,
			trailMetadata: {
				startPoint: latLngPoints[0] ?? null,
				endPoint: latLngPoints[latLngPoints.length - 1] ?? null,
				totalDistance: data.metadata.totalDistanceM / 1000,
				elevationGain: data.metadata.elevationGain,
				elevationLoss: data.metadata.elevationLoss,
			},
			gpxElevationPoints: data.elevationPoints,
			gpxLoaded: true,
			enhancedTrailPoints: data.enhanced,
		});
		get().calculateClosestPoint();
	},

	findTrailPointByDistance: (distance): EnhancedTrailPoint | null => {
		const { enhancedTrailPoints, trailMetadata } = get();

		if (!enhancedTrailPoints || enhancedTrailPoints.length === 0) {
			return null;
		}

		const totalDistanceM = (trailMetadata?.totalDistance ?? 0) * 1000;
		const EPSILON = 10;

		if (distance < EPSILON) {
			return enhancedTrailPoints[0];
		}
		if (totalDistanceM > 0 && distance >= totalDistanceM - EPSILON) {
			return enhancedTrailPoints[enhancedTrailPoints.length - 1];
		}

		return enhancedTrailPoints[findNearestPointIndex(enhancedTrailPoints, distance)];
	},

	findTrailPointByCoordinates: (lat, lng, maxDistanceM = 150): EnhancedTrailPoint | null => {
		const { enhancedTrailPoints } = get();

		if (!enhancedTrailPoints || enhancedTrailPoints.length === 0) {
			return null;
		}

		if (typeof L === 'undefined') {
			return null;
		}

		const closestIndex = nearestIndexByCoords(enhancedTrailPoints, lat, lng);
		const closestPoint = enhancedTrailPoints[closestIndex];
		const exactDistance = L.latLng(closestPoint.lat, closestPoint.lng).distanceTo(L.latLng(lat, lng));
		if (exactDistance <= maxDistanceM) {
			return closestPoint;
		}
		return null;
	},

	highlightTrailPosition: (position): void => {
		const state = get();
		let point: EnhancedTrailPoint | null = null;

		if ('distance' in position) {
			point = state.findTrailPointByDistance(position.distance);
		} else if ('lat' in position && 'lng' in position) {
			const maxDistanceM = 'maxDistance' in position ? position.maxDistance : undefined;
			point = state.findTrailPointByCoordinates(position.lat, position.lng, maxDistanceM);
		}

		if (point) {
			set({ highlightedTrailPoint: point });
			window.dispatchEvent(new CustomEvent('trailPositionHighlighted', { detail: { point } }));
		}
	},

	clearTrailHighlight: (force = false): void => {
		const state = get();
		if (state.tooltipPinnedFromShare && !force) {
			return;
		}
		set({ highlightedTrailPoint: null, tooltipPinnedFromShare: false });
		window.dispatchEvent(new CustomEvent('trailHighlightCleared'));
	},

	setTooltipPinnedFromShare: (pinned): void => {
		set({ tooltipPinnedFromShare: pinned });
	},

	requestRawGpxData: (): string | null => get().rawGpxData,
});
