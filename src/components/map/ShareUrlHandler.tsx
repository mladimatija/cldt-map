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
import { useMapStore, useStore, type MapStoreState, type StoreState, TrailState } from '@/lib/store';

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
		if (params.dir && params.dir !== useMapStore.getState().direction) {
			setDirection(params.dir);
			useStore.getState().broadcastDirectionChange?.(params.dir);
		}
		if (!shareParamsNeedMapFollowUp(params)) {
			clearShareUrl();
		}
	}, [clearShareUrl, setDirection]);

	// Fly the map to the shared view / progress point and strip share params from the URL.
	useEffect(() => {
		const params = shareParamsRef.current;
		if (!params || viewAppliedRef.current) return;

		if (params.dir && params.dir !== currentDirection) return;

		const hasLatLngView = params.lat !== undefined && params.lng !== undefined && params.progress === undefined;
		const hasProgress = params.progress !== undefined;
		const hasRuler = params.rulerRange !== undefined;

		if (!hasLatLngView && !hasProgress && !hasRuler) return;
		if (hasProgress && (!gpxLoaded || !enhancedTrailPoints?.length)) return;

		viewAppliedRef.current = true;

		const applyView = (): void => {
			let popupLatLng: L.LatLngTuple | null = null;

			if (hasLatLngView) {
				popupLatLng = [params.lat!, params.lng!];
				const zoom = params.zoom ?? map.getZoom();
				map.flyTo(popupLatLng, zoom, { duration: 0.5 });
			}

			if (hasProgress && enhancedTrailPoints?.length) {
				const targetDistanceM = params.progress! * 1000;
				let closest = enhancedTrailPoints[0];
				let minDiff = Math.abs(closest.distanceFromStart - targetDistanceM);
				for (let i = 1; i < enhancedTrailPoints.length; i++) {
					const d = Math.abs(enhancedTrailPoints[i].distanceFromStart - targetDistanceM);
					if (d < minDiff) {
						minDiff = d;
						closest = enhancedTrailPoints[i];
					}
				}
				popupLatLng = [closest.lat, closest.lng];
				const zoom = params.zoom ?? Math.max(map.getZoom(), 12);
				map.flyTo(popupLatLng, zoom, { duration: 0.5 });
				highlightTrailPosition?.({ distance: closest.distanceFromStart });
				setTooltipPinnedFromShare?.(true);
				tooltipAppliedRef.current = true;
			}

			if (params.rulerRange) {
				setRulerRange(params.rulerRange);
				setRulerEnabled(true);
			}

			if (!params.poi) {
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
