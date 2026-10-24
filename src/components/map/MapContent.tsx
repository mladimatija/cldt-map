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
import { useTrailJunctionsFetch } from '@/hooks/useTrailJunctionsFetch';
import { useCompletionAutoTrack } from '@/hooks/useCompletionAutoTrack';
import { useLocationTracking } from '@/hooks/useLocationTracking';
import { useSeasonalStatusFetch } from '@/hooks/useSeasonalStatusFetch';
import { useTrailOsmTagsFetch } from '@/hooks/useTrailOsmTagsFetch';
import { usePoisFetch } from '@/hooks/usePoisFetch';
import { usePanelListeners } from '@/hooks';
import { useWakeLock } from '@/hooks/useWakeLock';
import { ShareCopyToast } from '@/components/map/ShareCopyToast';
import { TileDownloadCompleteToast } from '@/components/map/TileDownloadCompleteToast';
import { MapAppearanceFilter } from '@/components/map/MapAppearanceFilter';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { Button } from '@/components/ui/Button';

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
const NavTargetOverlay = dynamic(
	() => import('@/components/map/NavTargetOverlay').then((m) => ({ default: m.NavTargetOverlay })),
	{ ssr: false },
);
const CoachmarkTour = dynamic(
	() => import('@/components/map/CoachmarkTour').then((m) => ({ default: m.CoachmarkTour })),
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
const TerrainOverlays = dynamic(
	() => import('@/components/map/TerrainOverlays').then((m) => ({ default: m.TerrainOverlays })),
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
const TrailJunctionLayer = dynamic(
	() => import('@/components/map/TrailJunctionLayer').then((m) => ({ default: m.TrailJunctionLayer })),
	{ ssr: false },
);
const MapKeyboardA11y = dynamic(() => import('@/components/map/MapKeyboardA11y'), { ssr: false });
const TrailA11yLiveRegion = dynamic(
	() => import('@/components/map/TrailA11yLiveRegion').then((m) => ({ default: m.TrailA11yLiveRegion })),
	{ ssr: false },
);
const TrailScrubber = dynamic(
	() => import('@/components/charts/TrailScrubber').then((m) => ({ default: m.TrailScrubber })),
	{ ssr: false },
);

/** Hides a map layer that throws instead of blanking the whole map; the error
 *  is still logged by ErrorBoundary. */
function MapLayerBoundary({ name, children }: { name: string; children: React.ReactNode }): React.ReactElement {
	return (
		<ErrorBoundary fallback={null} name={name}>
			{children}
		</ErrorBoundary>
	);
}

/** Compact stand-in for the control rail when it crashes, so the map stays usable. */
function MapControlsErrorFallback(): React.ReactElement {
	const t = useTranslations('error');
	return (
		<div className="z-controls absolute top-2 right-2 max-w-60 rounded-md bg-white p-3 text-sm shadow-lg dark:bg-[var(--bg-secondary)] dark:text-[var(--text-primary)]">
			<p className="mb-2">{t('somethingWentWrong')}</p>
			<Button size="sm" variant="primary" onClick={() => window.location.reload()}>
				{t('refreshPage')}
			</Button>
		</div>
	);
}

export default function MapContent(): React.ReactElement {
	const [initialLocationFetched, setInitialLocationFetched] = useState(false);
	const isLocating = useMapStore((state: MapStoreState) => state.isLocating);
	const userLocation = useMapStore((state: MapStoreState) => state.userLocation);
	const fakeUserLocationEnabled = useMapStore((state: MapStoreState) => state.fakeUserLocationEnabled);
	const gpxLoaded = useMapStore((state: MapStoreState) => state.gpxLoaded);
	const tourActive = useMapStore((state: MapStoreState) => state.tourActive);
	const permissionStatus = useMapStore((state: MapStoreState) => state.permissionStatus);
	const initLocationService = useMapStore((state: MapStoreState) => state.initLocationService);
	const requestLocationPermission = useMapStore((state: MapStoreState) => state.requestLocationPermission);
	const liveTrackingEnabled = useMapStore((state: MapStoreState) => state.liveTrackingEnabled);

	useSevereWeatherFetch();
	useMineAreasFetch();
	useTrailJunctionsFetch();
	useLocationTracking();
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
				// The live watch delivers the first fix; a one-off request would ask twice.
				if (!liveTrackingEnabled) {
					const getCurrentLocation = useMapStore.getState().getCurrentLocation;
					void getCurrentLocation();
				}
				queueMicrotask(() => setInitialLocationFetched(true));
			} else if (permissionStatus === null) {
				void checkAndRequestLocation(true);
			}
		}
	}, [
		fakeUserLocationEnabled,
		gpxLoaded,
		permissionStatus,
		checkAndRequestLocation,
		initialLocationFetched,
		liveTrackingEnabled,
	]);

	// Fetch once when permission is newly granted and live tracking is off (the
	// watch covers it otherwise; skip when fake location is enabled)
	useEffect(() => {
		if (fakeUserLocationEnabled || liveTrackingEnabled) {
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
	}, [
		fakeUserLocationEnabled,
		liveTrackingEnabled,
		permissionStatus,
		userLocation,
		isLocating,
		gpxLoaded,
		initialLocationFetched,
	]);

	return (
		<>
			<MapLayerBoundary name="TrailA11yLiveRegion">
				<TrailA11yLiveRegion />
			</MapLayerBoundary>
			<MapLayerBoundary name="MapKeyboardA11y">
				<MapKeyboardA11y />
			</MapLayerBoundary>
			<MapLayerBoundary name="DemoBanner">
				<DemoBanner />
			</MapLayerBoundary>
			<MapLayerBoundary name="OfflineIndicator">
				<OfflineIndicator />
			</MapLayerBoundary>
			<MapLayerBoundary name="StaleCacheNotification">
				<StaleCacheNotification />
			</MapLayerBoundary>
			<MapLayerBoundary name="ShareCopyToast">
				<ShareCopyToast />
			</MapLayerBoundary>
			<MapLayerBoundary name="TileDownloadCompleteToast">
				<TileDownloadCompleteToast />
			</MapLayerBoundary>
			<MapLayerBoundary name="GpxImportDropzone">
				<GpxImportDropzone />
			</MapLayerBoundary>
			<MapLayerBoundary name="DistanceRemainingOverlay">
				<DistanceRemainingOverlay />
			</MapLayerBoundary>
			<MapLayerBoundary name="NavTargetOverlay">
				<NavTargetOverlay />
			</MapLayerBoundary>
			{tourActive && (
				<MapLayerBoundary name="CoachmarkTour">
					<CoachmarkTour />
				</MapLayerBoundary>
			)}
			<MapLayerBoundary name="ShareUrlHandler">
				<ShareUrlHandler />
			</MapLayerBoundary>
			<MapLayerBoundary name="BaseMapSelector">
				<BaseMapSelector />
			</MapLayerBoundary>
			<MapLayerBoundary name="RadarOverlay">
				<RadarOverlay />
			</MapLayerBoundary>
			<MapLayerBoundary name="WaymarkedTrailsOverlay">
				<WaymarkedTrailsOverlay />
			</MapLayerBoundary>
			<MapLayerBoundary name="TerrainOverlays">
				<TerrainOverlays />
			</MapLayerBoundary>
			<MapLayerBoundary name="MapAppearanceFilter">
				<MapAppearanceFilter />
			</MapLayerBoundary>
			<Suspense fallback={<MapTrailLoadingFallback />}>
				<MapLayerBoundary name="TrailRoute">
					<TrailRoute pathOptions={DEFAULT_PATH_OPTIONS} />
				</MapLayerBoundary>
			</Suspense>
			<MapLayerBoundary name="SeasonalStatusTrailLayer">
				<SeasonalStatusTrailLayer />
			</MapLayerBoundary>
			<MapLayerBoundary name="ImportedTrackLayer">
				<ImportedTrackLayer />
			</MapLayerBoundary>
			<MapLayerBoundary name="TrailDistanceMarkers">
				<TrailDistanceMarkers />
			</MapLayerBoundary>
			<MapLayerBoundary name="PoiMarkers">
				<PoiMarkers />
			</MapLayerBoundary>
			<MapLayerBoundary name="UserWaypointMarkers">
				<UserWaypointMarkers />
			</MapLayerBoundary>
			<MapLayerBoundary name="PoiImageLightbox">
				<PoiImageLightbox />
			</MapLayerBoundary>
			<MapLayerBoundary name="MapMarkers">
				<MapMarkers />
			</MapLayerBoundary>
			<MapLayerBoundary name="SunsetSunriseMarkers">
				<SunsetSunriseMarkers />
			</MapLayerBoundary>
			<MapLayerBoundary name="StageBoundaryMarkers">
				<StageBoundaryMarkers />
			</MapLayerBoundary>
			<MapLayerBoundary name="NoticeMarkers">
				<NoticeMarkers />
			</MapLayerBoundary>
			<MapLayerBoundary name="SevereWeatherLayer">
				<SevereWeatherLayer />
			</MapLayerBoundary>
			<MapLayerBoundary name="MineAreaLayer">
				<MineAreaLayer />
			</MapLayerBoundary>
			<MapLayerBoundary name="TrailJunctionLayer">
				<TrailJunctionLayer />
			</MapLayerBoundary>
			<MapLayerBoundary name="CompletionOverlay">
				<CompletionOverlay />
			</MapLayerBoundary>
			<MapLayerBoundary name="ProgressPreviewOverlay">
				<ProgressPreviewOverlay />
			</MapLayerBoundary>
			<MapLayerBoundary name="JournalTrackHighlightOverlay">
				<JournalTrackHighlightOverlay />
			</MapLayerBoundary>
			<ErrorBoundary fallback={<MapControlsErrorFallback />} name="MapControls">
				<MapControls />
			</ErrorBoundary>
			<MapLayerBoundary name="RulerHint">
				<RulerHint />
			</MapLayerBoundary>
			<MapLayerBoundary name="ZoomControls">
				<ZoomControls />
			</MapLayerBoundary>
			<MapLayerBoundary name="LocationControls">
				<LocationControls checkPermission={checkAndRequestLocation} />
			</MapLayerBoundary>
			<div className="z-map-overlay absolute right-16 bottom-2 left-16 mx-2 flex flex-col gap-1 sm:mx-0">
				<MapLayerBoundary name="RadarControls">
					<RadarControls />
				</MapLayerBoundary>
				<MapLayerBoundary name="TrailScrubber">
					<TrailScrubber />
				</MapLayerBoundary>
				<MapLayerBoundary name="ElevationChart">
					<ElevationChart className="shadow-lg" />
				</MapLayerBoundary>
			</div>
		</>
	);
}
