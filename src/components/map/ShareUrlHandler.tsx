'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { parseShareUrlParams } from '@/lib/utils';
import { useMapStore, useStore, type MapStoreState, type StoreState, TrailState } from '@/lib/store';
import { KEY_TO_PROVIDER } from '@/components/map/base-map-options';

/**
 * Handles share URL params on "load": applies direction, unit, map style (baseMap, sections, dark), and shows
 * trail marker+tooltip at the shared location. Uses the same pulsing marker and trail info tooltip as when the user
 * clicks on the trail.
 */
export default function ShareUrlHandler(): null {
	const map = useMap();
	const appliedRef = useRef(false);
	const highlightTrailPosition = useStore((state: StoreState) => state.highlightTrailPosition);
	const clearTrailHighlight = useStore((state: StoreState) => state.clearTrailHighlight);
	const setTooltipPinnedFromShare = useStore((state: StoreState) => state.setTooltipPinnedFromShare);
	const setDirection = useMapStore((state: MapStoreState) => state.setDirection);
	const currentDirection = useMapStore((state: MapStoreState) => state.direction);
	const setBaseMapProvider = useMapStore((state: MapStoreState) => state.setBaseMapProvider);
	const setShowSections = useMapStore((state: MapStoreState) => state.setShowSections);
	const setDarkMode = useMapStore((state: MapStoreState) => state.setDarkMode);
	const setRulerEnabled = useMapStore((state: MapStoreState) => state.setRulerEnabled);
	const setRulerRange = useMapStore((state: MapStoreState) => state.setRulerRange);
	const gpxLoaded = useMapStore((state: MapStoreState) => state.gpxLoaded);
	const enhancedTrailPoints = useStore((state: TrailState) => state.enhancedTrailPoints);

	// Apply URL query params to store so the link's preferences are respected
	useEffect(() => {
		const params = parseShareUrlParams();
		if (!params) return;
		if (params.unit) {
			useMapStore.getState().setUnits?.(params.unit === 'mi' ? 'imperial' : 'metric');
			useStore.getState().setUnits?.(params.unit === 'mi' ? 'imperial' : 'metric');
		}
		if (params.baseMap) {
			const provider = KEY_TO_PROVIDER[params.baseMap];
			if (provider) {
				setBaseMapProvider(provider);
			}
		}
		if (params.sections !== undefined) {
			setShowSections(params.sections);
		}
		if (params.dark !== undefined) {
			setDarkMode(params.dark);
		}
	}, [setBaseMapProvider, setShowSections, setDarkMode]);

	useEffect(() => {
		const params = parseShareUrlParams();
		if (!params) return;

		// If the share link sets a direction, apply it first and wait for trail points to match that direction.
		if (params.dir && params.dir !== currentDirection) {
			setDirection(params.dir);
			useStore.getState().broadcastDirectionChange?.(params.dir);
			return;
		}

		const needsProgress = params.progress !== undefined;
		if (needsProgress && (!gpxLoaded || !enhancedTrailPoints?.length)) {
			return;
		}
		// For lat/lng only, wait for the trail to load so we can show the trail tooltip
		if (!needsProgress && (!gpxLoaded || !enhancedTrailPoints?.length)) return;
		if (appliedRef.current) return;

		const applyParams = (): void => {
			appliedRef.current = true;

			// Direction is already applied above (and waited for) if present.

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

			if (params.rulerRange) {
				// Set range first so map controls can render immediately when enabled.
				setRulerRange(params.rulerRange);
				setRulerEnabled(true);
			}
		};

		if (map.whenReady) {
			map.whenReady(applyParams);
		} else {
			applyParams();
		}
	}, [
		map,
		setDirection,
		currentDirection,
		gpxLoaded,
		enhancedTrailPoints,
		highlightTrailPosition,
		setTooltipPinnedFromShare,
		setRulerEnabled,
		setRulerRange,
	]);

	// Clear trail highlight on "unmount" (e.g., when navigating away)
	useEffect(
		() => () => {
			clearTrailHighlight?.(true);
		},
		[clearTrailHighlight],
	);

	return null;
}
