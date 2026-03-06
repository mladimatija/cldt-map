'use client';

/**
 * Orchestrates map overlays (controls, trail, markers, elevation chart) and location init.
 * Requests permission and fetches first location once trail is loaded; syncs isLocating from store.
 */
import React, { Suspense, useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { DEFAULT_PATH_OPTIONS } from '@/components/map/trail-route-constants';

function MapTrailLoadingFallback(): React.ReactElement {
	const t = useTranslations('mapWrapper');
	return <div className="map-loading">{t('loadingTrailData')}</div>;
}

const MapControls = dynamic(() => import('@/components/map/controls/MapControls'), { ssr: false });
const ZoomControls = dynamic(() => import('@/components/map/controls/MapControlsZoomControls'), { ssr: false });
const TrailRoute = dynamic(() => import('@/components/map/TrailRoute'), { ssr: false });
const LocationControls = dynamic(() => import('@/components/map/controls/MapControlsLocationControls'), { ssr: false });
const BaseMapSelector = dynamic(() => import('@/components/map/BaseMapSelector'), { ssr: false });
const MapMarkers = dynamic(() => import('@/components/map/MapMarkers'), { ssr: false });
const ShareUrlHandler = dynamic(() => import('@/components/map/ShareUrlHandler'), { ssr: false });
const GoToDistance = dynamic(() => import('@/components/map/GoToDistance'), { ssr: false });
const ElevationChart = dynamic(() => import('@/components/charts/ElevationChart'), { ssr: false });
const RulerHint = dynamic(() => import('@/components/map/controls/RulerHint').then((m) => ({ default: m.RulerHint })), {
	ssr: false,
});

export default function MapContent(): React.ReactElement {
	const [isLocating, setIsLocating] = useState(false);
	const [initialLocationFetched, setInitialLocationFetched] = useState(false);
	const userLocation = useMapStore((state: MapStoreState) => state.userLocation);
	const fakeUserLocationEnabled = useMapStore((state: MapStoreState) => state.fakeUserLocationEnabled);
	const gpxLoaded = useMapStore((state: MapStoreState) => state.gpxLoaded);
	const permissionStatus = useMapStore((state: MapStoreState) => state.permissionStatus);
	const initLocationService = useMapStore((state: MapStoreState) => state.initLocationService);
	const requestLocationPermission = useMapStore((state: MapStoreState) => state.requestLocationPermission);

	// Initialize location service once when the component mounts
	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		initLocationService();
	}, [initLocationService]);

	// Check permission and request location, optionally prompting the user
	const checkAndRequestLocation = useCallback(
		async (prompt = false): Promise<void> => {
			if (typeof window === 'undefined') {
				return;
			}
			try {
				if (prompt) {
					await requestLocationPermission();
				}
			} catch (error) {
				console.error('Error checking/requesting location permission:', error);
			}
		},
		[requestLocationPermission],
	);

	// Request location permission when map and trail data have loaded (skip when fake location is enabled)
	useEffect(() => {
		if (fakeUserLocationEnabled) {
			queueMicrotask(() => setInitialLocationFetched(true));
			return;
		}
		if (permissionStatus === 'denied') {
			return;
		}
		if (gpxLoaded && permissionStatus !== undefined && !initialLocationFetched) {
			if (permissionStatus === 'granted') {
				const getCurrentLocation = useMapStore.getState().getCurrentLocation;
				void getCurrentLocation();
				queueMicrotask(() => setInitialLocationFetched(true));
			} else if (permissionStatus === null) {
				void checkAndRequestLocation(true);
			}
		}
	}, [fakeUserLocationEnabled, gpxLoaded, permissionStatus, checkAndRequestLocation, initialLocationFetched]);

	// Handle location tracking status changes
	useEffect(() => {
		const locationState = useMapStore.getState().isLocating;
		queueMicrotask(() => setIsLocating(locationState));
		const unsubscribe = useMapStore.subscribe((state: MapStoreState) => {
			if (state.isLocating !== isLocating) {
				queueMicrotask(() => setIsLocating(state.isLocating));
			}
		});

		return () => unsubscribe();
	}, [isLocating]);

	// Track permission changes to fetch location when permission is newly granted (skip when fake location is enabled)
	useEffect(() => {
		if (fakeUserLocationEnabled) {
			return;
		}
		if (permissionStatus !== 'granted') {
			return;
		}
		if (!userLocation && !isLocating && gpxLoaded && !initialLocationFetched) {
			const getCurrentLocation = useMapStore.getState().getCurrentLocation;
			void getCurrentLocation();
			queueMicrotask(() => setInitialLocationFetched(true));
		}
	}, [fakeUserLocationEnabled, permissionStatus, userLocation, isLocating, gpxLoaded, initialLocationFetched]);

	return (
		<>
			<ShareUrlHandler />
			<GoToDistance />
			<BaseMapSelector />
			<Suspense fallback={<MapTrailLoadingFallback />}>
				<TrailRoute pathOptions={DEFAULT_PATH_OPTIONS} />
			</Suspense>
			<MapMarkers />
			<MapControls />
			<RulerHint />
			<ZoomControls />
			<LocationControls checkPermission={checkAndRequestLocation} />
			<ElevationChart className="z-map-overlay absolute right-14 bottom-2 left-14 mx-2 shadow-lg sm:mx-0" />
		</>
	);
}
