import type { LatLng } from 'leaflet';
import type { StateCreator } from 'zustand';
import { config } from '../config';
import { isWithinMapBoundary } from '../utils';
import type { StoreState, TrailSlice, TrailState, ClosestPoint, EnhancedTrailPoint } from './types';
import { L } from './leaflet';
import { findNearestPointIndex } from '../distance-utils';
import { buildSpatialGrid, type SpatialGrid } from '../spatial-grid';

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
 * by array identity so a trail reload naturally invalidates)
 * makes the per-tick lookup near-constant.
 */
const trailGridCache = new WeakMap<LatLng[], SpatialGrid>();

function computeClosestPointData(
	points: LatLng[],
	enhancedPoints: EnhancedTrailPoint[],
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
	return {
		point: closestPoint,
		distance: closestDistance,
		distanceFromStart: enhancedPoints[closestIndex]?.distanceFromStart ?? 0,
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
		const closestPointData = computeClosestPointData(state.trailPoints, state.enhancedTrailPoints, userLatLng);
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
				// The kept point's line state still holds: its distance moved < 5 m.
				set({ closestPointCalculated: true });
				return;
			}
			set({
				closestPoint: closestPointData,
				closestPointCalculated: true,
				showClosestPointLine: closestPointData.distance < 10000,
			});
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
		const closestPointData = computeClosestPointData(points, state.enhancedTrailPoints, userLatLng);
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

	applyComputedTrailData: (data): void => {
		if (typeof L === 'undefined') return;
		// The only main-thread cost left: materialise Leaflet LatLng instances
		// (closest-point consumers call .distanceTo on trailPoints). Enhanced
		// points are plain objects and transfer straight from the worker.
		const latLngPoints = data.enhanced.map((p) => L.latLng(p.lat, p.lng));
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
			// A fresh object every time, so highlighting the same point again (a second
			// click, a scrubber step that lands on it) still re-renders its tooltip.
			set({ highlightedTrailPoint: { ...point } });
		}
	},

	clearTrailHighlight: (force = false): void => {
		const state = get();
		if (state.tooltipPinnedFromShare && !force) {
			return;
		}
		set({ highlightedTrailPoint: null, tooltipPinnedFromShare: false });
	},

	setTooltipPinnedFromShare: (pinned): void => {
		set({ tooltipPinnedFromShare: pinned });
	},

	requestRawGpxData: (): string | null => get().rawGpxData,
});
