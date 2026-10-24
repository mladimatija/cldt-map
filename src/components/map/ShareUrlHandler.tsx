'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
	applyShareMapStyleParams,
	clearShareUrlParams,
	getInitialShareUrlParams,
	shareParamsNeedMapFollowUp,
	type ShareUrlParams,
} from '@/lib/utils';
import {
	normalizeShareTripStateToSobo,
	parseShareTripState,
	sharedTripHasData,
	type ShareTripStatePayload,
} from '@/lib/share-trip-state';
import { findNearestPointIndex } from '@/lib/distance-utils';
import { toSoboM, toSoboRange } from '@/lib/trail-frame';
import { flyToOrSetView } from '@/lib/map-view';
import {
	useMapStore,
	useStore,
	type MapStoreState,
	type StoreState,
	type TrailDirection,
	TrailState,
} from '@/lib/store';

/**
 * Handles share URL params on load: applies unit, map style (baseMap, trailStyle,
 * layers, dark), and shows trail marker+tooltip at the shared location. Uses the
 * same pulsing marker and trail info tooltip as when the user clicks on the trail.
 * After params are applied the query string is removed so `/s/{code}` redirects
 * leave a clean URL in the address bar.
 */
export default function ShareUrlHandler(): null {
	const map = useMap();
	const router = useRouter();
	const pathname = usePathname();
	const shareParamsRef = useRef<ShareUrlParams | null>(getInitialShareUrlParams());
	const viewAppliedRef = useRef(false);
	const tooltipAppliedRef = useRef(false);
	const urlClearedRef = useRef(false);
	/** Trip state from the link, offered for import once the trail has loaded:
	 *  an older (version 1) northbound link needs the trail length, and a
	 *  pending one-time km migration of the local data runs first. */
	const pendingTripStateRef = useRef<{ payload: ShareTripStatePayload; linkDirection: TrailDirection } | null>(null);
	const highlightTrailPosition = useStore((state: StoreState) => state.highlightTrailPosition);
	const clearTrailHighlight = useStore((state: StoreState) => state.clearTrailHighlight);
	const setTooltipPinnedFromShare = useStore((state: StoreState) => state.setTooltipPinnedFromShare);
	const setDirection = useMapStore((state: MapStoreState) => state.setDirection);
	const currentDirection = useMapStore((state: MapStoreState) => state.direction);
	const setRulerEnabled = useMapStore((state: MapStoreState) => state.setRulerEnabled);
	const setRulerRange = useMapStore((state: MapStoreState) => state.setRulerRange);
	const gpxLoaded = useMapStore((state: MapStoreState) => state.gpxLoaded);
	const enhancedTrailPoints = useStore((state: TrailState) => state.enhancedTrailPoints);

	const clearShareUrl = useCallback((): void => {
		if (urlClearedRef.current) return;
		urlClearedRef.current = true;
		clearShareUrlParams();
		router.replace(pathname);
	}, [pathname, router]);

	// Apply style and direction from the landing URL (including `/s/{code}` redirects).
	useEffect(() => {
		const params = shareParamsRef.current;
		if (!params) return;
		applyShareMapStyleParams(params);
		if (params.tripState) {
			// Never applied silently: the import dialog asks once the trail is ready.
			pendingTripStateRef.current = {
				payload: params.tripState,
				linkDirection: params.dir ?? useMapStore.getState().direction,
			};
		}
		if (params.dir && params.dir !== useMapStore.getState().direction) {
			setDirection(params.dir);
			useStore.getState().broadcastDirectionChange?.(params.dir);
		}
		if (!shareParamsNeedMapFollowUp(params)) {
			clearShareUrl();
		}
	}, [clearShareUrl, setDirection]);

	// Offer the link's trip state for import: mirror older local data first (a
	// no-op once done) so the two never mix frames, convert older northbound
	// links from km from Prevlaka to SOBO km, then hand it to the dialog.
	useEffect(() => {
		const pending = pendingTripStateRef.current;
		if (!pending || !gpxLoaded || !enhancedTrailPoints?.length) return;
		pendingTripStateRef.current = null;
		const totalKm = enhancedTrailPoints[enhancedTrailPoints.length - 1].distanceFromStart / 1000;
		useMapStore.getState().applyKmFrameMigration?.(totalKm);
		const data = parseShareTripState(normalizeShareTripStateToSobo(pending.payload, pending.linkDirection, totalKm));
		if (!sharedTripHasData(data)) return;
		const store = useMapStore.getState();
		// The demo is a sandbox over the real data; nothing is imported into it.
		if (store.demoModeActive) return;
		const focusWaypointId = shareParamsRef.current?.wp;
		// A waypoint link whose waypoints are all already here just opens its popup.
		const onlyKnownWaypoints =
			data.stagePlan === null &&
			data.journal.length === 0 &&
			data.done.length === 0 &&
			data.stars.length === 0 &&
			data.waypoints.every((wp) => store.userWaypoints.some((own) => own.id === wp.id));
		if (focusWaypointId && onlyKnownWaypoints) return;
		store.setPendingSharedTrip({ data, ...(focusWaypointId && { focusWaypointId }) });
	}, [gpxLoaded, enhancedTrailPoints]);

	// Fly the map to the shared view / progress point and strip share params from the URL.
	useEffect(() => {
		const params = shareParamsRef.current;
		if (!params || viewAppliedRef.current) return;

		if (params.dir && params.dir !== currentDirection) return;

		const hasLatLngView = params.lat !== undefined && params.lng !== undefined && params.progress === undefined;
		const hasProgress = params.progress !== undefined;
		const hasRuler = params.rulerRange !== undefined;

		if (!hasLatLngView && !hasProgress && !hasRuler) return;
		// Progress and ruler are travel distances under the link's `dir`; converting
		// them to the stored SOBO frame needs the loaded trail's length.
		if ((hasProgress || hasRuler) && (!gpxLoaded || !enhancedTrailPoints?.length)) return;

		viewAppliedRef.current = true;

		const applyView = (): void => {
			let popupLatLng: L.LatLngTuple | null = null;

			if (hasLatLngView) {
				popupLatLng = [params.lat!, params.lng!];
				const zoom = params.zoom ?? map.getZoom();
				flyToOrSetView(map, popupLatLng, zoom, { duration: 0.5 });
			}

			const totalM = enhancedTrailPoints.length
				? enhancedTrailPoints[enhancedTrailPoints.length - 1].distanceFromStart
				: 0;

			if (hasProgress && enhancedTrailPoints?.length) {
				const targetSoboM = toSoboM(params.progress! * 1000, currentDirection, totalM);
				const closest = enhancedTrailPoints[findNearestPointIndex(enhancedTrailPoints, targetSoboM)];
				popupLatLng = [closest.lat, closest.lng];
				const zoom = params.zoom ?? Math.max(map.getZoom(), 12);
				flyToOrSetView(map, popupLatLng, zoom, { duration: 0.5 });
				highlightTrailPosition?.({ distance: closest.distanceFromStart });
				setTooltipPinnedFromShare?.(true);
				tooltipAppliedRef.current = true;
			}

			if (params.rulerRange) {
				const sobo = toSoboRange(
					params.rulerRange.distanceFromStartA,
					params.rulerRange.distanceFromStartB,
					currentDirection,
					totalM,
				);
				setRulerRange({ distanceFromStartA: sobo.from, distanceFromStartB: sobo.to });
				setRulerEnabled(true);
			}

			if (!params.poi && !params.wp) {
				clearShareUrl();
			}
		};

		if (map.whenReady) {
			map.whenReady(applyView);
		} else {
			applyView();
		}
	}, [
		map,
		currentDirection,
		gpxLoaded,
		enhancedTrailPoints,
		highlightTrailPosition,
		setTooltipPinnedFromShare,
		setRulerEnabled,
		setRulerRange,
		clearShareUrl,
	]);

	// lat/lng shares: show the trail tooltip once GPX is loaded (URL already cleaned above).
	useEffect(() => {
		const params = shareParamsRef.current;
		if (!params || tooltipAppliedRef.current) return;
		if (params.progress !== undefined) return;
		if (params.lat === undefined || params.lng === undefined) return;
		if (!gpxLoaded || !enhancedTrailPoints?.length) return;

		tooltipAppliedRef.current = true;
		highlightTrailPosition?.({ lat: params.lat, lng: params.lng });
		setTooltipPinnedFromShare?.(true);
	}, [gpxLoaded, enhancedTrailPoints, highlightTrailPosition, setTooltipPinnedFromShare]);

	// Clear trail highlight on "unmount" (e.g., when navigating away)
	useEffect(
		() => () => {
			clearTrailHighlight?.(true);
		},
		[clearTrailHighlight],
	);

	return null;
}
