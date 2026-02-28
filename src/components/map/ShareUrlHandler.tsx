'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { parseShareUrlParams } from '@/lib/utils';
import { useMapStore, useStore, type MapStoreState, type StoreState, TrailState } from '@/lib/store';

/**
 * Handles share URL params on load: applies direction and unit, shows trail marker+tooltip at shared location.
 * Uses the same pulsing marker and trail info tooltip as when the user clicks on the trail.
 */
export default function ShareUrlHandler(): null {
	const map = useMap();
	const appliedRef = useRef(false);
	const highlightTrailPosition = useStore((state: StoreState) => state.highlightTrailPosition);
	const clearTrailHighlight = useStore((state: StoreState) => state.clearTrailHighlight);
	const setTooltipPinnedFromShare = useStore((state: StoreState) => state.setTooltipPinnedFromShare);
	const setDirection = useMapStore((state: MapStoreState) => state.setDirection);
	const gpxLoaded = useMapStore((state: MapStoreState) => state.gpxLoaded);
	const enhancedTrailPoints = useStore((state: TrailState) => state.enhancedTrailPoints);

	// Apply URL unit to store so the link's unit is respected (overrides localStorage)
	useEffect(() => {
		const params = parseShareUrlParams();
		if (params?.unit) {
			useMapStore.getState().setUnits?.(params.unit === 'mi' ? 'imperial' : 'metric');
			useStore.getState().setUnits?.(params.unit === 'mi' ? 'imperial' : 'metric');
		}
	}, []);

	useEffect(() => {
		const params = parseShareUrlParams();
		if (!params) return;

		const needsProgress = params.progress !== undefined;
		if (needsProgress && (!gpxLoaded || !enhancedTrailPoints?.length)) {
			return;
		}
		// For lat/lng only, wait for the trail to load so we can show the trail tooltip
		if (!needsProgress && (!gpxLoaded || !enhancedTrailPoints?.length)) return;
		if (appliedRef.current) return;

		const applyParams = (): void => {
			appliedRef.current = true;

			if (params.dir) {
				setDirection(params.dir);
				useStore.getState().broadcastDirectionChange?.(params.dir);
			}

			let popupLatLng: L.LatLngTuple | null = null;

			if (params.lat !== undefined && params.lng !== undefined && !needsProgress) {
				popupLatLng = [params.lat, params.lng];
				const zoom = params.zoom ?? map.getZoom();
				map.flyTo(popupLatLng, zoom, { duration: 0.5 });
			}

			if (params.progress !== undefined && enhancedTrailPoints?.length) {
				// progress is in km; find the trail point whose distanceFromStart (m) is closest
				const targetDistanceM = params.progress * 1000;
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

				// Use trail highlight (pulsing marker + trail info tooltip) instead of a custom popup
				highlightTrailPosition?.({ distance: closest.distanceFromStart });
				setTooltipPinnedFromShare?.(true);
			} else if (popupLatLng && gpxLoaded) {
				// lat/lng params: try to find the closest trail point and show the trail tooltip
				highlightTrailPosition?.({ lat: popupLatLng[0], lng: popupLatLng[1] });
				setTooltipPinnedFromShare?.(true);
			}
		};

		if (map.whenReady) {
			map.whenReady(applyParams);
		} else {
			applyParams();
		}
	}, [map, setDirection, gpxLoaded, enhancedTrailPoints, highlightTrailPosition, setTooltipPinnedFromShare]);

	// Clear trail highlight on unmount (e.g., when navigating away)
	useEffect(
		() => () => {
			clearTrailHighlight?.(true);
		},
		[clearTrailHighlight],
	);

	return null;
}
