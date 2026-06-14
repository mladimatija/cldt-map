'use client';

/**
 * Orchestrates map overlays (controls, trail, markers, elevation chart) and location init.
 * Requests permission and fetches the first location once the trail is loaded; syncs isLocating from store.
 */
import React, { Suspense, useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { DEFAULT_PATH_OPTIONS } from '@/components/map/trail-route-constants';
import { useSevereWeatherFetch } from '@/hooks/useSevereWeatherFetch';
import { useMineAreasFetch } from '@/hooks/useMineAreasFetch';
import { useCompletionAutoTrack } from '@/hooks/useCompletionAutoTrack';
import { useSeasonalStatusFetch } from '@/hooks/useSeasonalStatusFetch';
import { useTrailOsmTagsFetch } from '@/hooks/useTrailOsmTagsFetch';
import { usePoisFetch } from '@/hooks/usePoisFetch';
import { usePanelListeners } from '@/hooks';
import { useWakeLock } from '@/hooks/useWakeLock';
import { ShareCopyToast } from '@/components/map/ShareCopyToast';
import { TileDownloadCompleteToast } from '@/components/map/TileDownloadCompleteToast';

function MapTrailLoadingFallback(): React.ReactElement {
	const t = useTranslations('mapWrapper');
	return <div className="map-loading">{t('loadingTrailData')}</div>;
}

const MapControls = dynamic(() => import('@/components/map/controls/MapControls'), { ssr: false });
const ZoomControls = dynamic(() => import('@/components/map/controls/MapControlsZoomControls'), { ssr: false });
const TrailRoute = dynamic(() => import('@/components/map/TrailRoute'), { ssr: false });
const SeasonalStatusTrailLayer = dynamic(() => import('@/components/map/SeasonalStatusTrailLayer'), { ssr: false });
const LocationControls = dynamic(() => import('@/components/map/controls/MapControlsLocationControls'), { ssr: false });
const BaseMapSelector = dynamic(() => import('@/components/map/BaseMapSelector'), { ssr: false });
const MapMarkers = dynamic(() => import('@/components/map/MapMarkers'), { ssr: false });
const ShareUrlHandler = dynamic(() => import('@/components/map/ShareUrlHandler'), { ssr: false });
const ElevationChart = dynamic(() => import('@/components/charts/ElevationChart'), { ssr: false });
const RulerHint = dynamic(() => import('@/components/map/controls/RulerHint').then((m) => ({ default: m.RulerHint })), {
	ssr: false,
});
const OfflineIndicator = dynamic(
	() => import('@/components/map/OfflineIndicator').then((m) => ({ default: m.OfflineIndicator })),
	{ ssr: false },
);
const DemoBanner = dynamic(() => import('@/components/map/DemoBanner').then((m) => ({ default: m.DemoBanner })), {
	ssr: false,
});
const StaleCacheNotification = dynamic(
	() => import('@/components/map/StaleCacheNotification').then((m) => ({ default: m.StaleCacheNotification })),
	{ ssr: false },
);
const DistanceRemainingOverlay = dynamic(
	() => import('@/components/map/DistanceRemainingOverlay').then((m) => ({ default: m.DistanceRemainingOverlay })),
	{ ssr: false },
);
const NoticeMarkers = dynamic(
	() => import('@/components/map/NoticeMarkers').then((m) => ({ default: m.NoticeMarkers })),
	{ ssr: false },
);
const SunsetSunriseMarkers = dynamic(() => import('@/components/map/SunsetSunriseMarkers'), { ssr: false });
const TrailDistanceMarkers = dynamic(
	() => import('@/components/map/TrailDistanceMarkers').then((m) => ({ default: m.TrailDistanceMarkers })),
	{ ssr: false },
);
const PoiMarkers = dynamic(() => import('@/components/map/PoiMarkers').then((m) => ({ default: m.PoiMarkers })), {
	ssr: false,
});
const WaymarkedTrailsOverlay = dynamic(
	() => import('@/components/map/WaymarkedTrailsOverlay').then((m) => ({ default: m.WaymarkedTrailsOverlay })),
	{ ssr: false },
);
const UserWaypointMarkers = dynamic(
	() => import('@/components/map/UserWaypointMarkers').then((m) => ({ default: m.UserWaypointMarkers })),
	{ ssr: false },
);
const PoiImageLightbox = dynamic(
	() => import('@/components/map/PoiImageLightbox').then((m) => ({ default: m.PoiImageLightbox })),
	{ ssr: false },
);
const StageBoundaryMarkers = dynamic(() => import('@/components/map/StageBoundaryMarkers'), { ssr: false });
const RadarOverlay = dynamic(() => import('@/components/map/RadarOverlay').then((m) => ({ default: m.RadarOverlay })), {
	ssr: false,
});
const RadarControls = dynamic(
	() => import('@/components/map/RadarControls').then((m) => ({ default: m.RadarControls })),
	{ ssr: false },
);
const GpxImportDropzone = dynamic(() => import('@/components/map/GpxImportDropzone'), { ssr: false });
const ImportedTrackLayer = dynamic(() => import('@/components/map/ImportedTrackLayer'), { ssr: false });
const SevereWeatherLayer = dynamic(
	() => import('@/components/map/SevereWeatherLayer').then((m) => ({ default: m.SevereWeatherLayer })),
	{ ssr: false },
);
const CompletionOverlay = dynamic(
	() => import('@/components/map/CompletionOverlay').then((m) => ({ default: m.CompletionOverlay })),
	{ ssr: false },
);
const ProgressPreviewOverlay = dynamic(
	() => import('@/components/map/ProgressPreviewOverlay').then((m) => ({ default: m.ProgressPreviewOverlay })),
	{ ssr: false },
);
const JournalTrackHighlightOverlay = dynamic(
	() =>
		import('@/components/map/JournalTrackHighlightOverlay').then((m) => ({ default: m.JournalTrackHighlightOverlay })),
	{ ssr: false },
);
const MineAreaLayer = dynamic(
	() => import('@/components/map/MineAreaLayer').then((m) => ({ default: m.MineAreaLayer })),
	{ ssr: false },
);

export default function MapContent(): React.ReactElement {
	const [initialLocationFetched, setInitialLocationFetched] = useState(false);
	const isLocating = useMapStore((state: MapStoreState) => state.isLocating);
	const userLocation = useMapStore((state: MapStoreState) => state.userLocation);
	const fakeUserLocationEnabled = useMapStore((state: MapStoreState) => state.fakeUserLocationEnabled);
	const gpxLoaded = useMapStore((state: MapStoreState) => state.gpxLoaded);
	const permissionStatus = useMapStore((state: MapStoreState) => state.permissionStatus);
	const initLocationService = useMapStore((state: MapStoreState) => state.initLocationService);
	const requestLocationPermission = useMapStore((state: MapStoreState) => state.requestLocationPermission);

	useSevereWeatherFetch();
	useMineAreasFetch();
	useCompletionAutoTrack();
	useSeasonalStatusFetch();
	useTrailOsmTagsFetch();
	usePoisFetch();
	// Keep the screen awake while actively tracking, when the user opted in.
	// Battery saver wins over the wake lock since its whole point is saving power.
	const keepScreenOn = useMapStore((state: MapStoreState) => state.keepScreenOn);
	const batterySaverModeForWakeLock = useMapStore((state: MapStoreState) => state.batterySaverMode);
	useWakeLock(keepScreenOn && !batterySaverModeForWakeLock && permissionStatus === 'granted' && !!userLocation);
	// Coordinates mutual-exclusion close behavior for every panel that
	// registers via `usePanel` (map controls + base map dropdown).
	usePanelListeners();

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
			<DemoBanner />
			<OfflineIndicator />
			<StaleCacheNotification />
			<ShareCopyToast />
			<TileDownloadCompleteToast />
			<GpxImportDropzone />
			<DistanceRemainingOverlay />
			<ShareUrlHandler />
			<BaseMapSelector />
			<RadarOverlay />
			<WaymarkedTrailsOverlay />
			<Suspense fallback={<MapTrailLoadingFallback />}>
				<TrailRoute pathOptions={DEFAULT_PATH_OPTIONS} />
			</Suspense>
			<SeasonalStatusTrailLayer />
			<ImportedTrackLayer />
			<TrailDistanceMarkers />
			<PoiMarkers />
			<UserWaypointMarkers />
			<PoiImageLightbox />
			<MapMarkers />
			<SunsetSunriseMarkers />
			<StageBoundaryMarkers />
			<NoticeMarkers />
			<SevereWeatherLayer />
			<MineAreaLayer />
			<CompletionOverlay />
			<ProgressPreviewOverlay />
			<JournalTrackHighlightOverlay />
			<MapControls />
			<RulerHint />
			<ZoomControls />
			<LocationControls checkPermission={checkAndRequestLocation} />
			<div className="z-map-overlay absolute right-16 bottom-2 left-16 mx-2 flex flex-col gap-1 sm:mx-0">
				<RadarControls />
				<ElevationChart className="shadow-lg" />
			</div>
		</>
	);
}
