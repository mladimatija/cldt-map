import type { LatLng } from 'leaflet';
import type * as GeoJSON from 'geojson';
import type { TrailDirection, UnitSystem } from '../types';
import type { TileCacheMeta } from '../tile-cache';
import type { TrackPoint } from '../gpx-parser';
import type { SeasonalStatusEntry, SeasonalStatusFile } from '../seasonal-status';
import type { TrailOsmTagsFile } from '../trail-osm-tags';
import type { MineAreasFile } from '../mine-areas';
import type { CompletionInterval } from '../completion';
import type { JournalEntry, UserWaypoint } from '../user-waypoints';
import type { WaypointCategoryId } from '../waypoint-categories';
import type { PackList } from '../pack-csv';
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
	/** Applies a dataset precomputed by the trail worker (parse + enhance
	 *  done off-thread); replaces processTrailData's O(n) main-thread loop. */
	applyComputedTrailData: (data: import('../trail-compute').ComputedTrailData) => void;
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

export interface ShareCopyToast {
	status: 'success' | 'error';
	short: boolean;
	nonce: number;
}

/** Saved type + tag filter combination in the POI list panel. */
export interface PoiFilterPreset {
	id: string;
	name: string;
	enabledPoiTypes: string[];
	enabledPoiTags: string[];
}

/** Stage-planner inputs captured for a named what-if preset (e.g. "20 km relaxed"
 *  vs "30 km push"). Only the inputs are stored; applying re-runs the split. */
export interface StagePlanPresetInputs {
	startKm: number;
	endKm: number;
	mode: 'kmPerDay' | 'stages';
	kmPerDayKm: number;
	stageCount: number;
	balanceByEta: boolean;
	maxHoursPerDay: number;
	startDate?: string;
}

export interface StagePlanPreset {
	id: string;
	name: string;
	inputs: StagePlanPresetInputs;
}

/** Named list of starred POI ids (trip brief "Selected only", share export). */
export interface StarredPoiCollection {
	id: string;
	name: string;
	poiIds: string[];
}

export const DEFAULT_STARRED_COLLECTION_NAME = 'Starred';

export function isDefaultStarredCollectionName(name: string): boolean {
	return name === DEFAULT_STARRED_COLLECTION_NAME;
}

export function getActiveStarredPoiIds(
	state: Pick<MapStoreState, 'starredPoiCollections' | 'activeStarredCollectionId'>,
): ReadonlySet<string> {
	const active = state.starredPoiCollections.find((c) => c.id === state.activeStarredCollectionId);
	if (!active) return new Set<string>();
	return new Set(active.poiIds);
}

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
	/** User preference: show the optional zoom-15 ahead pack controls. Persisted. */
	offlineHighDetailAheadEnabled: boolean;
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
		opts?: { source?: 'manual' | 'autoSync' },
	) => Promise<void>;
	cancelTileDownload: () => void;
	clearTileCacheForProvider: (providerKey?: string) => Promise<void>;
	loadTileCacheMeta: (providerKey: string) => Promise<void>;
	setAutoSync: (enabled: boolean) => void;
	setPredictivePrecache: (enabled: boolean) => void;
	setOfflineHighDetailAheadEnabled: (enabled: boolean) => void;
	startHighDetailAheadDownload: () => Promise<void>;
	maybeRunPredictivePrecache: (opts?: { source: 'online' | 'gps' | 'network' | 'battery' }) => Promise<void>;
	handleQuotaExceeded: () => void;

	showStaleCacheNotification: boolean;
	setStaleCacheNotification: (show: boolean) => void;
	initStaleCacheCheck: () => Promise<void>;

	/** Set after the first successful manual offline download to show contextual PWA copy. */
	pwaInstallTrigger: 'offlineDownload' | null;
	clearPwaInstallTrigger: () => void;
	tileDownloadCompleteToast: boolean;
	clearTileDownloadCompleteToast: () => void;

	walkingPaceKmh: number;
	setWalkingPaceKmh: (pace: number) => void;

	/** Pack base weight in kg (canonical metric; converted at the UI
	 *  boundary). Null disables every pack-weight surface. Persisted. */
	packBaseWeightKg: number | null;
	setPackBaseWeightKg: (kg: number | null) => void;
	/** Drinking rate in L/h used for water carry suggestions. Persisted. */
	waterConsumptionLph: number;
	setWaterConsumptionLph: (lph: number) => void;
	/** Food consumption rate in kg/day for resupply cadence estimates. Persisted. */
	foodConsumptionKgPerDay: number;
	setFoodConsumptionKgPerDay: (kgPerDay: number) => void;
	/** Apply the pack-weight pace penalty to ETAs. Persisted. */
	packEtaAdjust: boolean;
	setPackEtaAdjust: (enabled: boolean) => void;
	/** Imported gear list (LighterPack/Packstack CSV); null when none.
	 *  Importing also fills packBaseWeightKg. Persisted. */
	packGearList: PackList | null;
	setPackGearList: (list: PackList | null) => void;
	/** Seasonal-alert web push opt-in (mirrors the browser subscription). Persisted. */
	pushAlertsEnabled: boolean;
	setPushAlertsEnabled: (enabled: boolean) => void;
	/** Waymarked Trails hiking-routes overlay on top of the base map. Persisted. */
	waymarkedTrailsOverlay: boolean;
	setWaymarkedTrailsOverlay: (enabled: boolean) => void;
	/** Copy compact `/s/{code}` links when sharing the map or a POI. Persisted. */
	shareShortLinks: boolean;
	setShareShortLinks: (enabled: boolean) => void;
	/** Ephemeral toast for share-link copy feedback (session-only). */
	shareCopyToast: ShareCopyToast | null;
	showShareCopyToast: (feedback: { status: 'success' | 'error'; short: boolean }) => void;
	clearShareCopyToast: () => void;

	/** Personal map annotations (long-press to add). Persisted. */
	userWaypoints: UserWaypoint[];
	addUserWaypoint: (wp: UserWaypoint) => void;
	updateUserWaypoint: (id: string, patch: Partial<Pick<UserWaypoint, 'name' | 'note' | 'category'>>) => void;
	removeUserWaypoint: (id: string) => void;
	/** Waypoint id whose popup should open (set by the progress panel list);
	 *  consumed and cleared by the marker layer. Session-only. */
	pendingOpenWaypointId: string | null;
	requestOpenWaypoint: (id: string) => void;
	clearPendingOpenWaypoint: () => void;
	/** Default category for newly dropped waypoints. Persisted. */
	lastWaypointCategory: WaypointCategoryId;
	setLastWaypointCategory: (category: WaypointCategoryId) => void;
	hiddenWaypointCategories: Set<WaypointCategoryId>;
	toggleWaypointCategoryOnMap: (category: WaypointCategoryId) => void;
	setHiddenWaypointCategories: (hidden: Set<WaypointCategoryId>) => void;

	/** Dated trip journal entries, optionally attached to a km range. Persisted. */
	journalEntries: JournalEntry[];
	addJournalEntry: (entry: JournalEntry) => void;
	updateJournalEntry: (
		id: string,
		patch: Partial<Pick<JournalEntry, 'date' | 'text' | 'startKm' | 'endKm' | 'trackLink'>>,
	) => void;
	removeJournalEntry: (id: string) => void;
	/** Which journal list row is highlighted on the map. Session-only. */
	journalHighlightEntryId: string | null;
	setJournalHighlightEntryId: (id: string | null) => void;
	/** Ephemeral journal segment preview on the map. Session-only. */
	journalPreview: JournalPreview | null;
	setJournalPreview: (preview: JournalPreview | null) => void;

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
	/** Updates color/visibility in the store and persists to localforage. */
	updateImportedTrack: (id: string, patch: Partial<Pick<ImportedTrack, 'color' | 'visible'>>) => void;
	/** Track ids whose on-trail coverage has been folded into completion
	 *  progress; lets the progress panel offer add/remove as a toggle.
	 *  Persisted. */
	progressTrackIds: string[];
	addProgressTrackId: (id: string) => void;
	removeProgressTrackId: (id: string) => void;
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
	/** Progress panel: My waypoints section expanded. Persisted. */
	progressPanelWaypointsOpen: boolean;
	setProgressPanelWaypointsOpen: (open: boolean) => void;
	/** Progress panel: Trip journal section expanded. Persisted. */
	progressPanelJournalOpen: boolean;
	setProgressPanelJournalOpen: (open: boolean) => void;
	/** Settings panel: Map overlays section expanded. Persisted. */
	settingsPanelOverlaysOpen: boolean;
	setSettingsPanelOverlaysOpen: (open: boolean) => void;
	/** Settings panel: Pack & pace section expanded. Persisted. */
	settingsPanelPackOpen: boolean;
	setSettingsPanelPackOpen: (open: boolean) => void;
	/** Settings panel: Notifications & sharing section expanded. Persisted. */
	settingsPanelNotificationsOpen: boolean;
	setSettingsPanelNotificationsOpen: (open: boolean) => void;
	/** Settings panel: Offline maps section expanded. null = open when tile cache exists. Persisted. */
	settingsPanelOfflineOpen: boolean | null;
	setSettingsPanelOfflineOpen: (open: boolean | null) => void;
	/** Settings panel: Imports section expanded. Persisted. */
	settingsPanelImportsOpen: boolean;
	setSettingsPanelImportsOpen: (open: boolean) => void;
	/** Help panel: Map basics section expanded. Persisted. */
	helpPanelBasicsOpen: boolean;
	setHelpPanelBasicsOpen: (open: boolean) => void;
	/** Help panel: Elevation chart section expanded. Persisted. */
	helpPanelChartOpen: boolean;
	setHelpPanelChartOpen: (open: boolean) => void;
	/** Help panel: Hidden gestures section expanded. Persisted. */
	helpPanelGesturesOpen: boolean;
	setHelpPanelGesturesOpen: (open: boolean) => void;
	/** Help panel: Planning tools section expanded. Persisted. */
	helpPanelPlanningOpen: boolean;
	setHelpPanelPlanningOpen: (open: boolean) => void;
	/** Help panel: Offline section expanded. Persisted. */
	helpPanelOfflineOpen: boolean;
	setHelpPanelOfflineOpen: (open: boolean) => void;
	/** Help panel: Demo hike section expanded. Persisted. */
	helpPanelDemoOpen: boolean;
	setHelpPanelDemoOpen: (open: boolean) => void;
	/** POI list panel: Filters section expanded. Persisted. */
	poiListFiltersOpen: boolean;
	setPoiListFiltersOpen: (open: boolean) => void;
	/** POI list panel: Sort section expanded. Persisted. */
	poiListSortOpen: boolean;
	setPoiListSortOpen: (open: boolean) => void;
	/** POI list panel: Tags section expanded. Persisted. */
	poiListTagsOpen: boolean;
	setPoiListTagsOpen: (open: boolean) => void;
	/** POI list panel: Star collections section expanded. Persisted. */
	poiListStarsOpen: boolean;
	setPoiListStarsOpen: (open: boolean) => void;
	/** POI list panel: Export section expanded. Persisted. */
	poiListExportOpen: boolean;
	setPoiListExportOpen: (open: boolean) => void;
	/** Stage planner: Plan setup section expanded. Persisted. */
	stagePlannerSetupOpen: boolean;
	setStagePlannerSetupOpen: (open: boolean) => void;
	/** Stage planner: Stages list section expanded. Persisted. */
	stagePlannerStagesOpen: boolean;
	setStagePlannerStagesOpen: (open: boolean) => void;
	/** Stage planner: Export section expanded. Persisted. */
	stagePlannerExportOpen: boolean;
	setStagePlannerExportOpen: (open: boolean) => void;
	/** Session-only: scroll target when opening settings from progress panel. */
	settingsScrollTarget: 'imports' | null;
	openSettingsToImports: () => void;
	clearSettingsScrollTarget: () => void;
	/** Session-only: scroll target when opening help from stage planner. */
	helpScrollTarget: 'planning' | null;
	openHelpToPlanning: () => void;
	clearHelpScrollTarget: () => void;
	/** Ephemeral preview of km intervals before confirming a GPX add-to-progress. */
	progressPreviewTrackId: string | null;
	progressPreviewIntervals: CompletionInterval[];
	setProgressPreview: (trackId: string | null, intervals: CompletionInterval[]) => void;

	showUpNext: boolean;
	setShowUpNext: (show: boolean) => void;
	/** Optional Up Next row: nearest restaurant or cafe ahead. Default off. */
	upNextShowFood: boolean;
	setUpNextShowFood: (show: boolean) => void;
	/** Optional Up Next row: nearest ATM ahead. Default off. */
	upNextShowAtm: boolean;
	setUpNextShowAtm: (show: boolean) => void;
	/** Optional Up Next row: nearest viewpoint ahead. Default off. */
	upNextShowViewpoint: boolean;
	setUpNextShowViewpoint: (show: boolean) => void;
	/** Optional Up Next row: nearest town with a pharmacy ahead. Default off. */
	upNextShowPharmacy: boolean;
	setUpNextShowPharmacy: (show: boolean) => void;
	/** Expanded state of the optional "More ahead" block in the distance panel. */
	upNextMoreExpanded: boolean;
	setUpNextMoreExpanded: (expanded: boolean) => void;

	/** Forward corridor length (km) for "along next N km" POI browsing; persisted. */
	aheadHorizonKm: number;
	setAheadHorizonKm: (km: number) => void;
	/** One-shot sort request consumed when the POI list panel opens. */
	pendingPoiListSort: 'ahead' | null;
	/** Open the POI list in "along next N km" sort mode. */
	requestPoiListAhead: () => void;
	clearPendingPoiListSort: () => void;

	// ── Walk simulator (session-only, never persisted) ─────────────────
	/** Mirrored UI state of the walk simulator; null when not active. */
	walkSim: {
		running: boolean;
		posKm: number;
		speedKmh: number;
		walkDirection: TrailDirection;
		offsetM: number;
		totalKm: number;
	} | null;
	setWalkSim: (state: MapStoreState['walkSim']) => void;

	// ── End-user demo mode (/demo; session-only, never persisted) ───────
	demoModeActive: boolean;
	demoPersistSnapshot: {
		userWaypoints: UserWaypoint[];
		journalEntries: JournalEntry[];
		completedIntervals: CompletionInterval[];
	} | null;
	enterDemoMode: (snapshot: NonNullable<MapStoreState['demoPersistSnapshot']>) => void;

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
	/** When false (default), POIs with `isReachable === false` are hidden. */
	includeRemotePois: boolean;
	setIncludeRemotePois: (enabled: boolean) => void;
	/** True once the user has explicitly modified either POI filter (types or
	 *  tags). Lets the POI disclaimer handlers re-seed defaults the first time
	 *  the layer is enabled without overwriting a user's prior customisation. */
	poiFiltersUserModified: boolean;
	/** Reset both POI filters to their initial defaults without flipping
	 *  `poiFiltersUserModified` - used by the disclaimer handlers, not by
	 *  user-facing controls. */
	resetPoiFiltersToDefaults: () => void;
	/** Named saved type + tag filter combinations. */
	poiFilterPresets: PoiFilterPreset[];
	savePoiFilterPreset: (name: string) => string | null;
	applyPoiFilterPreset: (id: string) => void;
	deletePoiFilterPreset: (id: string) => void;
	renamePoiFilterPreset: (id: string, name: string) => void;
	/** Named stage-planner what-if presets (inputs only; apply re-runs the split). */
	stagePlanPresets: StagePlanPreset[];
	saveStagePlanPreset: (name: string, inputs: StagePlanPresetInputs) => string | null;
	deleteStagePlanPreset: (id: string) => void;
	/** Named starred POI lists; stars apply to the active collection. */
	starredPoiCollections: StarredPoiCollection[];
	activeStarredCollectionId: string | null;
	setActiveStarredCollectionId: (id: string) => void;
	createStarredPoiCollection: (name: string) => string | null;
	renameStarredPoiCollection: (id: string, name: string) => void;
	deleteStarredPoiCollection: (id: string) => void;
	toggleStarredPoi: (id: string) => void;
	clearStarredPois: () => void;
	/** Replace all starred collections with one default list (share URL import). */
	importStarredPoisFromShare: (poiIds: string[]) => void;
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

export interface JournalPreview {
	/** null when previewing a draft add-form entry */
	entryId: string | null;
	trailStartKm: number;
	trailEndKm: number;
	trackId?: string;
	startIdx?: number;
	endIdx?: number;
	trackColor?: string;
}

export interface ImportedTrack {
	id: string; // FNV-1a content hash (hex string)
	name: string;
	points: TrackPoint[];
	importedAt: number; // Date.now()
	color: string; // from TRACK_COLOR_PALETTE cycle; user-adjustable
	/** Hidden from the map without deleting; undefined means visible
	 *  (pre-feature tracks stay shown). */
	visible?: boolean;
}

export interface TrackStats {
	totalDistanceM: number;
	totalElapsedSec: number; // 0 if no timestamps
	totalMovingSec: number; // 0 if no timestamps
	avgMovingPaceSecPerKm: number; // 0 if no distance or no timestamps
	maxDeviationM: number;
	/** Share of the TRACK that runs within 25 m of the official trail. */
	coveragePercent: number;
	/** Cumulative ascent / descent (m) over the recorded elevation, 5 m hysteresis. 0 if no elevation. */
	elevationGainM: number;
	elevationLossM: number;
	/** Number of pauses longer than 2 min (the gaps excluded from moving time). */
	stopCount: number;
	/** movingTime / elapsedTime as a percent; 0 if no timestamps. */
	movingEfficiencyPct: number;
}
