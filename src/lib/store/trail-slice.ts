import type { LatLng } from 'leaflet';
import type { StateCreator } from 'zustand';
import { config } from '../config';
import { isWithinMapBoundary } from '../utils';
import type { StoreState, TrailSlice, TrailState, ClosestPoint, EnhancedTrailPoint } from './types';
import { L } from './leaflet';

type GpxElevationPoint = { lat: number; lng: number; elevation: number };

/**
 * Compute closest point on trail to a given location. Pure helper used by
 * calculateClosestPoint and forceCalculateClosestPointFromLocation.
 */
function computeClosestPointData(
	points: LatLng[],
	userLatLng: LatLng,
	gpxElevationPoints: GpxElevationPoint[] | null,
): ClosestPoint | null {
	let closestPoint: LatLng | null = null;
	let closestDistance = Infinity;
	let closestIndex = -1;

	points.forEach((point, index) => {
		const distance = userLatLng.distanceTo(point);
		if (distance < closestDistance) {
			closestDistance = distance;
			closestPoint = point;
			closestIndex = index;
		}
	});

	if (!closestPoint || closestIndex === -1) {
		return null;
	}

	let distanceFromStart = 0;
	let distanceToEnd = 0;
	for (let i = 1; i <= closestIndex; i++) {
		distanceFromStart += points[i - 1].distanceTo(points[i]);
	}
	for (let i = closestIndex; i < points.length - 1; i++) {
		distanceToEnd += points[i].distanceTo(points[i + 1]);
	}

	let elevationGainSoFar = 0;
	if (gpxElevationPoints && gpxElevationPoints.length > 0) {
		for (let i = 1; i <= closestIndex; i++) {
			if (gpxElevationPoints[i] && gpxElevationPoints[i - 1]) {
				const elevDiff = gpxElevationPoints[i].elevation - gpxElevationPoints[i - 1].elevation;
				if (elevDiff > 0) {
					elevationGainSoFar += elevDiff;
				}
			}
		}
	}

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
		const closestPointData = computeClosestPointData(state.trailPoints, userLatLng, state.gpxElevationPoints);
		if (closestPointData) {
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
		const closestPointData = computeClosestPointData(points, userLatLng, state.gpxElevationPoints);
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

	processTrailData: (points, elevationPoints, startPoint, endPoint, distance, elevGain, elevLoss): void => {
		set({
			trailPoints: points,
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

			enhancedPoints.push({
				lat: points[i].lat,
				lng: points[i].lng,
				elevation: elevationPoints?.[i]?.elevation || 0,
				distanceFromStart: cumulativeDistance,
				elevationGainFromStart: cumulativeElevGain,
				elevationLossFromStart: cumulativeElevLoss,
				index: i,
			});
		}

		set({ enhancedTrailPoints: enhancedPoints });

		setTimeout(() => {
			get().calculateClosestPoint();
		}, 500);
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

		let closestPoint = enhancedTrailPoints[0];
		let minDiff = Math.abs(closestPoint.distanceFromStart - distance);

		for (let i = 1; i < enhancedTrailPoints.length; i++) {
			const diff = Math.abs(enhancedTrailPoints[i].distanceFromStart - distance);
			if (diff < minDiff) {
				minDiff = diff;
				closestPoint = enhancedTrailPoints[i];
			}
		}

		return closestPoint;
	},

	findTrailPointByCoordinates: (lat, lng): EnhancedTrailPoint | null => {
		const { enhancedTrailPoints } = get();

		if (!enhancedTrailPoints || enhancedTrailPoints.length === 0) {
			return null;
		}

		if (typeof L === 'undefined') {
			return null;
		}

		const targetPoint = L.latLng(lat, lng);

		let closestPoint = enhancedTrailPoints[0];
		let minDistance = L.latLng(closestPoint.lat, closestPoint.lng).distanceTo(targetPoint);

		for (let i = 1; i < enhancedTrailPoints.length; i++) {
			const pointLatLng = L.latLng(enhancedTrailPoints[i].lat, enhancedTrailPoints[i].lng);
			const distance = pointLatLng.distanceTo(targetPoint);

			if (distance < minDistance) {
				minDistance = distance;
				closestPoint = enhancedTrailPoints[i];
			}
		}

		const maxDistanceThreshold = 150;

		if (minDistance <= maxDistanceThreshold) {
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
			point = state.findTrailPointByCoordinates(position.lat, position.lng);
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
