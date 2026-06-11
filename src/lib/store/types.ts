import type { LatLng } from 'leaflet';
import type * as GeoJSON from 'geojson';
import type { TrailDirection, UnitSystem } from '../types';
import type { TileCacheMeta } from '../tile-cache';
import type { TrackPoint } from '../gpx-parser';
import type { SeasonalStatusEntry, SeasonalStatusFile } from '../seasonal-status';
import type { TrailOsmTagsFile } from '../trail-osm-tags';
import type { MineAreasFile } from '../mine-areas';
import type { CompletionInterval } from '../completion';
import type { PoiImage, PoisFile } from '../pois';
import { RulerRange } from '@/lib/distance-utils';

export type { TrailDirection, UnitSystem };
export type { TrackPoint } from '../gpx-parser';

export interface LocationState {
	userLocation: { lat: number; lng: number; accuracy?: number } | null;
	isLocating: boolean;
	initialLocationSet: boolean;
	permissionStatus: 'granted' | 'denied' | 'prompt' | null;
	locationError: { code: number; message: string } | null;
	showUserMarker: boolean;
}

export interface LocationActions {
	setUserLocation: (location: { lat: number; lng: number; accuracy?: number } | null) => void;
	setIsLocating: (isLocating: boolean) => void;
	setPermissionStatus: (status: 'granted' | 'denied' | 'prompt' | null) => void;
	setLocationError: (error: { code: number; message: string } | null) => void;
	setShowUserMarker: (show: boolean) => void;

	handleLocationUpdate: (location: LatLng) => void;
	getCurrentLocation: () => Promise<void>;
	initLocationService: () => void;
	requestLocationPermission: () => Promise<void>;
}

export type LocationSlice = LocationState & LocationActions;

export interface ClosestPoint {
	point: LatLng;
	distance: number;
	distanceFromStart: number;
	distanceToEnd: number;
	elevationGainSoFar?: number;
}

export interface EnhancedTrailPoint {
	lat: number;
	lng: number;
	elevation: number;
	distanceFromStart: number;
	elevationGainFromStart: number;
	elevationLossFromStart: number;
	index: number;
	sectionName?: string;
	/** Bearing in degrees (0-360, clockwise from north) from this point to the next.
	 * The last point inherits the previous point's bearing; single-point trails get 0. */
	bearingDeg: number;
	/** Signed grade percent: positive when ascending in the current direction, negative when descending. */
	gradePct: number;
	/** Bucketed |gradePct|: 0 flat, 1 moderate, 2 steep, 3 very steep, 4 extreme. */
	gradeBand: 0 | 1 | 2 | 3 | 4;
}

export interface TrailMetadata {
	startPoint: LatLng | null;
	endPoint: LatLng | null;
	totalDistance: number;
	elevationGain: number;
	elevationLoss: number;
}

export interface TrailState {
	trailPoints: LatLng[];
	enhancedTrailPoints: EnhancedTrailPoint[];
	highlightedTrailPoint: EnhancedTrailPoint | null;
	tooltipPinnedFromShare: boolean;
	boundaryInitialized: boolean;
	gpxLoaded: boolean;
	gpxLoadFailed: boolean;
	closestPointCalculated: boolean;
	showClosestPointLine: boolean;
	closestPoint: ClosestPoint | null;
	trailMetadata: TrailMetadata;
	rawGpxData: string | null;
	gpxElevationPoints: { lat: number; lng: number; elevation: number }[] | null;
	direction: TrailDirection;
}

export interface TrailActions {
	setTrailPoints: (points: LatLng[]) => void;
	setEnhancedTrailPoints: (points: EnhancedTrailPoint[]) => void;
	setHighlightedTrailPoint: (point: EnhancedTrailPoint | null) => void;
	setBoundaryInitialized: (initialized: boolean) => void;
	setGpxLoaded: (loaded: boolean) => void;
	setGpxLoadFailed: (failed: boolean) => void;
	setClosestPointCalculated: (calculated: boolean) => void;
	setShowClosestPointLine: (show: boolean) => void;
	setClosestPoint: (point: ClosestPoint | null) => void;
	setTrailMetadata: (metadata: TrailMetadata) => void;
	setRawGpxData: (data: string) => void;
	setGpxElevationPoints: (points: { lat: number; lng: number; elevation: number }[]) => void;
	setDirection: (direction: TrailDirection) => void;

	calculateClosestPoint: () => void;
	forceCalculateClosestPointFromLocation: (location: { lat: number; lng: number }) => void;
	broadcastDirectionChange: (newDirection: TrailDirection) => void;
	processTrailData: (
		points: LatLng[],
		elevationPoints: { lat: number; lng: number; elevation: number }[],
		startPoint: LatLng | null,
		endPoint: LatLng | null,
		distance: number,
		elevGain: number,
		elevLoss: number,
	) => void;
	highlightTrailPosition: (
		position: { lat: number; lng: number; maxDistance?: number } | { distance: number; elevation?: number },
	) => void;
	clearTrailHighlight: (force?: boolean) => void;
	setTooltipPinnedFromShare: (pinned: boolean) => void;
	requestRawGpxData: () => string | null;
	findTrailPointByDistance: (distance: number) => EnhancedTrailPoint | null;
	findTrailPointByCoordinates: (lat: number, lng: number, maxDistanceM?: number) => EnhancedTrailPoint | null;
}

export type TrailSlice = TrailState & TrailActions;

export interface UIState {
	showBoundary: boolean;
	showTileBoundary: boolean;
	units: UnitSystem;
	mapMountTime: number | null;
}

export interface UIActions {
	setShowBoundary: (show: boolean) => void;
	setShowTileBoundary: (show: boolean) => void;
	setUnits: (units: UnitSystem) => void;
	setMapMountTime: (time: number) => void;
	broadcastUnitsChange: (newUnits: UnitSystem) => void;
}

export type UISlice = UIState & UIActions;

export type StoreState = LocationSlice & TrailSlice & UISlice;

export interface MapStoreState {
	selectedTrail: string | null;
	setSelectedTrail: (id: string | null) => void;

	trailData: GeoJSON.FeatureCollection | null;
	setTrailData: (data: GeoJSON.FeatureCollection | null) => void;

	startPoint: LatLng | null;
	endPoint: LatLng | null;
	totalDistance: number;
	elevationGain: number;
	elevationLoss: number;

	rawGpxData?: string | null;
	setRawGpxData: (data: string | null) => void;
	gpxElevationPoints?: { lat: number; lng: number; elevation: number }[];
	setGpxElevationPoints: (points: { lat: number; lng: number; elevation: number }[]) => void;
	gpxLoaded?: boolean;
	setGpxLoaded: (loaded: boolean) => void;
	gpxLoadFailed?: boolean;
	setGpxLoadFailed: (failed: boolean) => void;
	reloadTrailRequested: number;
	setReloadTrailRequested: (timestamp: number) => void;
	trailPoints?: LatLng[];
	requestRawGpxData?: () => string | null;
	processTrailData?: (
		points: LatLng[],
		elevationPoints: { lat: number; lng: number; elevation: number }[],
		startPoint: LatLng | null,
		endPoint: LatLng | null,
		totalDistance: number,
		elevationGain: number,
		elevationLoss: number,
	) => void;

	units: UnitSystem;
	setUnits: (units: UnitSystem) => void;
	distancePrecision: number;
	setDistancePrecision: (precision: number) => void;

	direction: TrailDirection;
	setDirection: (direction: TrailDirection) => void;

	showBoundary: boolean;
	setShowBoundary: (show: boolean) => void;
	showTileBoundary: boolean;
	setShowTileBoundary: (show: boolean) => void;

	isRulerEnabled: boolean;
	setRulerEnabled: (enabled: boolean) => void;

	showRadarOverlay: boolean;
	setShowRadarOverlay: (show: boolean) => void;
	radarFrames: Array<{ time: number; url: string }>;
	setRadarFrames: (frames: Array<{ time: number; url: string }>) => void;
	radarFrameIndex: number;
	setRadarFrameIndex: (index: number) => void;
	radarPlaying: boolean;
	setRadarPlaying: (playing: boolean) => void;
	/** When the distance ruler has two points, the range in meters from trail start; used to highlight the chart. */
	rulerRange: RulerRange | null;
	setRulerRange: (range: RulerRange | null) => void;

	userLocation: { lat: number; lng: number; accuracy?: number } | null;
	isLocating: boolean;
	permissionStatus: 'granted' | 'denied' | 'prompt' | null;
	locationError: { code: number; message: string } | null;
	setUserLocation: (location: { lat: number; lng: number; accuracy?: number } | null) => void;
	setIsLocating: (isLocating: boolean) => void;
	setPermissionStatus: (status: 'granted' | 'denied' | 'prompt' | null) => void;
	setLocationError: (error: { code: number; message: string } | null) => void;
	getCurrentLocation: () => Promise<{ lat: number; lng: number; error?: { code: number; message: string } }>;
	initLocationService: () => void;
	requestLocationPermission: () => Promise<void>;
	showUserMarker: boolean;
	setShowUserMarker: (show: boolean) => void;
	fakeUserLocationEnabled: boolean;
	setFakeUserLocationEnabled: (enabled: boolean) => void;
	setFakeUserLocation: () => void;
	setFakeUserLocationOnTrail: () => Promise<void>;

	darkMode: boolean;
	setDarkMode: (enabled: boolean) => void;
	batterySaverMode: boolean;
	setBatterySaverMode: (enabled: boolean) => void;
	/** Compass heading cone on the user-location marker (DeviceOrientation).
	 *  iOS requires a permission prompt; the settings toggle handles it. */
	compassEnabled: boolean;
	setCompassEnabled: (enabled: boolean) => void;
	/** Hold a screen wake lock while tracking with GPS so the display does
	 *  not sleep mid-hike. Battery saver mode overrides this off. */
	keepScreenOn: boolean;
	setKeepScreenOn: (enabled: boolean) => void;
	/** Off-route alert capability (banner + vibration when drifting off the
	 *  trail). Arms itself only after consecutive on-trail fixes, so it is
	 *  safe to leave enabled while away from the trail. */
	offRouteAlertEnabled: boolean;
	setOffRouteAlertEnabled: (enabled: boolean) => void;
	largeTouchTargets: boolean;
	setLargeTouchTargets: (enabled: boolean) => void;
	showSections: boolean;
	setShowSections: (show: boolean) => void;
	gradeTintedTrail: boolean;
	setGradeTintedTrail: (enabled: boolean) => void;
	surfaceColoured: boolean;
	setSurfaceColoured: (enabled: boolean) => void;
	sacColoured: boolean;
	setSacColoured: (enabled: boolean) => void;
	showDistanceMarkers: boolean;
	setShowDistanceMarkers: (show: boolean) => void;
	baseMapProvider: string;
	setBaseMapProvider: (provider: string) => void;

	isMapFullscreen: boolean;
	setMapFullscreen: (fullscreen: boolean) => void;

	/** Id of the currently open overlay panel (precision, settings, share, ...)
	 *  or null when none is open. Mutually exclusive: opening one closes any
	 *  previous. Refs and document listeners live in `usePanelManager`. */
	openPanel: string | null;
	setOpenPanel: (id: string | null) => void;
	togglePanel: (id: string) => void;
	closePanel: () => void;

	// ── Offline / tile cache ─────────────────────────────────────────────────
	isOffline: boolean;
	setIsOffline: (offline: boolean) => void;
	initOfflineDetection: () => void;

	tileCacheDownloading: boolean;
	tileCacheDone: number;
	tileCacheTotal: number;
	tileCacheError: string | null;
	tileCacheMeta: TileCacheMeta | null;
	autoSync: boolean;
	predictivePrecache: boolean;
	/** Incremented each time the background POI asset prefetch completes so
	 *  components can react without setTimeout. */
	poiPrefetchVersion: number;
	/** Number of assets the last user-initiated POI prefetch could not cache
	 *  (network errors, unsafe URLs, missing fields). Null until a prefetch
	 *  has run; lets the cache panel surface partial failures instead of
	 *  failing silently. */
	poiPrefetchSkipped: number | null;

	startTileDownload: (
		points: { lat: number; lng: number; distanceFromStart: number }[],
		providerName: string,
	) => Promise<void>;
	cancelTileDownload: () => void;
	clearTileCacheForProvider: (providerKey?: string) => Promise<void>;
	loadTileCacheMeta: (providerKey: string) => Promise<void>;
	setAutoSync: (enabled: boolean) => void;
	setPredictivePrecache: (enabled: boolean) => void;
	maybeRunPredictivePrecache: (opts?: { source: 'online' | 'gps' | 'network' | 'battery' }) => Promise<void>;
	handleQuotaExceeded: () => void;

	showStaleCacheNotification: boolean;
	setStaleCacheNotification: (show: boolean) => void;
	initStaleCacheCheck: () => Promise<void>;

	walkingPaceKmh: number;
	setWalkingPaceKmh: (pace: number) => void;

	gradeAdjustedEta: boolean;
	setGradeAdjustedEta: (enabled: boolean) => void;

	sunsetProjection: boolean;
	setSunsetProjection: (enabled: boolean) => void;

	stagePlan: StagePlan | null;
	setStagePlan: (plan: StagePlan) => void;
	clearStagePlan: () => void;

	importedTracks: ImportedTrack[];
	addImportedTrack: (track: ImportedTrack) => void;
	removeImportedTrack: (id: string) => Promise<void>;
	setImportedTracks: (tracks: ImportedTrack[]) => void;
	loadImportedTracksFromStorage: () => Promise<void>;

	hoveredImportedTrackId: string | null;
	setHoveredImportedTrackId: (id: string | null) => void;

	// ── Severe weather ──────────────────────────────────────────────────
	severeWeatherLayer: boolean;
	setSevereWeatherLayer: (enabled: boolean) => void;
	severeWeatherData: GeoJSON.FeatureCollection | null;
	setSevereWeatherData: (data: GeoJSON.FeatureCollection | null) => void;

	// ── Section completion tracking ─────────────────────────────────────
	/** Normalized completed [startKm, endKm] intervals (SOBO km); persisted. */
	completedIntervals: CompletionInterval[];
	markCompleted: (startKm: number, endKm: number) => void;
	unmarkCompleted: (startKm: number, endKm: number) => void;
	clearCompletion: () => void;
	/** Record progress automatically from on-trail GPS fixes; persisted. */
	completionAutoTrack: boolean;
	setCompletionAutoTrack: (enabled: boolean) => void;
	/** Draw completed stretches as a green overlay on the trail; persisted. */
	showCompletionOverlay: boolean;
	setShowCompletionOverlay: (show: boolean) => void;

	// ── Dev walk simulator (test page; session-only, never persisted) ───
	/** Mirrored UI state of the dev walk simulator; null when not active. */
	walkSim: {
		running: boolean;
		posKm: number;
		speedKmh: number;
		walkDirection: TrailDirection;
		offsetM: number;
		totalKm: number;
	} | null;
	setWalkSim: (state: MapStoreState['walkSim']) => void;

	// ── Mine-suspected areas (MSP) ──────────────────────────────────────
	/** Layer toggle; persisted, defaults ON (safety layer, opt-out). */
	mineAreasEnabled: boolean;
	setMineAreasEnabled: (enabled: boolean) => void;
	/** Bundled dataset loaded at runtime; null until fetched. */
	mineAreasFile: MineAreasFile | null;
	setMineAreasFile: (file: MineAreasFile | null) => void;

	// ── Trail OSM tag enrichment (surface, highway, SAC, MTB scale) ──
	trailOsmTagsFile: TrailOsmTagsFile | null;
	setTrailOsmTagsFile: (file: TrailOsmTagsFile | null) => void;

	// ── Points of Interest (towns, settlements, future categories) ──
	poisFile: PoisFile | null;
	setPoisFile: (file: PoisFile | null) => void;
	/** Master on/off for the POI map layer. */
	poisLayerEnabled: boolean;
	setPoisLayerEnabled: (enabled: boolean) => void;
	/** Unix-ms timestamp of the last time the user dismissed the POI source
	 *  disclaimer with "Don't show for 30 days". `null` means never dismissed,
	 *  so the dialog opens on the next enable. */
	poiDisclaimerDismissedAt: number | null;
	setPoiDisclaimerDismissedAt: (ts: number | null) => void;
	/** Per-type filter: a type present in this set is rendered, absent is hidden. */
	enabledPoiTypes: ReadonlySet<string>;
	setEnabledPoiTypes: (types: ReadonlySet<string>) => void;
	togglePoiType: (type: string) => void;
	/** Per-tag filter. Empty set means "no tag filter" - all POIs that pass
	 *  the type filter are shown. Non-empty set means "only POIs whose tags
	 *  intersect this set". Tag-less POIs are always hidden when the filter
	 *  is active, otherwise the filter would be a no-op for any dataset that
	 *  isn't fully tagged. */
	enabledPoiTags: ReadonlySet<string>;
	setEnabledPoiTags: (tags: ReadonlySet<string>) => void;
	togglePoiTag: (tag: string) => void;
	clearPoiTags: () => void;
	/** True once the user has explicitly modified either POI filter (types or
	 *  tags). Lets the POI disclaimer handlers re-seed defaults the first time
	 *  the layer is enabled without overwriting a user's prior customisation. */
	poiFiltersUserModified: boolean;
	/** Reset both POI filters to their initial defaults without flipping
	 *  `poiFiltersUserModified` - used by the disclaimer handlers, not by
	 *  user-facing controls. */
	resetPoiFiltersToDefaults: () => void;
	/** POI ids the user has explicitly starred for trip-brief "Selected only" scope.
	 *  Persisted in the store so the selection survives panel close/reopen and
	 *  is still present when the trip-brief modal is opened. */
	starredPoiIds: ReadonlySet<string>;
	toggleStarredPoi: (id: string) => void;
	clearStarredPois: () => void;
	/** POI id the renderer should fly to and open the popup for on the next
	 *  effect tick. Set by panels that want to surface a POI on the map
	 *  (e.g. the stage planner places list); cleared by PoiMarkers after
	 *  the fly+open dance completes. */
	pendingOpenPoiId: string | null;
	requestOpenPoi: (id: string) => void;
	clearPendingOpenPoi: () => void;
	/** Active lightbox state. When `images` is non-null, `PoiImageLightbox`
	 *  renders fullscreen with `index` pointing at the visible image. The
	 *  popup gallery sets these on thumbnail click; the lightbox clears
	 *  them on close. */
	lightboxImages: PoiImage[] | null;
	lightboxIndex: number;
	openLightbox: (images: PoiImage[], index: number) => void;
	closeLightbox: () => void;
	setLightboxIndex: (index: number) => void;

	// ── Seasonal trail status ──────────────────────────────────────────
	seasonalStatusFile: SeasonalStatusFile | null;
	setSeasonalStatusFile: (file: SeasonalStatusFile | null) => void;
	seasonalStatusEntries: SeasonalStatusEntry[];
	seasonalStatusLayerEnabled: boolean;
	seasonalStatusLayerUserToggled: boolean;
	setSeasonalStatusLayerEnabled: (enabled: boolean) => void;
	seasonalStatusModalEntry: SeasonalStatusEntry | null;
	setSeasonalStatusModalEntry: (entry: SeasonalStatusEntry | null) => void;
	seasonalStatusHoveredEntryId: string | null;
	setSeasonalStatusHoveredEntryId: (id: string | null) => void;
}

export interface StagePlan {
	startKm: number;
	endKm: number;
	stages: { startKm: number; endKm: number }[];
	balanceMode: 'distance' | 'eta';
	/** Trip start date (yyyy-mm-dd). Optional; enables per-stage weather
	 *  forecasts for stages within the 16-day Open-Meteo horizon. */
	startDate?: string;
}

export interface ImportedTrack {
	id: string; // FNV-1a content hash (hex string)
	name: string;
	points: TrackPoint[];
	importedAt: number; // Date.now()
	color: string; // from TRACK_COLOR_PALETTE cycle
}

export interface TrackStats {
	totalDistanceM: number;
	totalElapsedSec: number; // 0 if no timestamps
	totalMovingSec: number; // 0 if no timestamps
	avgMovingPaceSecPerKm: number; // 0 if no distance or no timestamps
	maxDeviationM: number;
	coveragePercent: number;
}
