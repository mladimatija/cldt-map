import type * as GeoJSON from 'geojson';
import type { LatLng } from 'leaflet';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { isAheadHorizonKm } from '../poi-ahead-corridor';
import { isUiTextScale, type UiTextScale } from '../ui-text-scale';
import {
	config,
	defaultEnabledPoiTypes,
	seasonalStatusLayerEnabledOverride,
	TRAIL_OFF_TRAIL_THRESHOLD_M,
} from '../config';
import { getRandomLocationInBoundary, toLocationError } from '../utils';
import { canShowOfflineInstallNudge, canShowPwaInstallPrompt, isStandalone } from '../pwa-install';
import { LocationService } from '../services/location-service';
import {
	DEFAULT_STARRED_COLLECTION_NAME,
	type ImportedTrack,
	type LastKnownFix,
	type MapStoreState,
	type SosCard,
	SOS_CARD_FIELDS,
	SOS_CARD_FIELD_MAX_LEN,
	type StagePlan,
	type StoreState,
	type TrailDirection,
	type UnitSystem,
} from './types';
import {
	generateTrailTileUrls,
	precacheTiles,
	saveTileCacheMeta,
	getTileCacheMeta,
	clearTileCache,
	getTileUrlTemplate,
	getProviderCacheKey,
	isProviderCacheable,
	isCacheStale,
	estimateStorage,
	requestPersistentStorage,
	runPredictivePrecache,
	abortPredictivePrecache,
	resetPredictivePrecacheBuckets,
	buildHighDetailAheadSlice,
	generateAheadHighDetailTileUrls,
	PRECACHE_ZOOM_MIN,
	PRECACHE_ZOOM_MAX,
	PRECACHE_ZOOM_MAX_HIGH,
	type TileCacheMeta,
	type NavigatorWithConnection,
	type NavigatorWithBattery,
	type PredictivePrecacheSlicePoint,
} from '../tile-cache';
import { findNearestPointIndex, RulerRange } from '@/lib/distance-utils';
import { loadImportedTracks, persistImportedTrackPatch, removeImportedTrack } from '../imported-tracks';
import { loadPois } from '@/lib/pois';
import { prefetchPoiAssets, prefetchPoisAlongSlice } from '@/lib/poi-prefetch';
import { addInterval, removeInterval, type CompletionInterval } from '../completion';
import { clampPaceFactor, DEFAULT_WATER_CONSUMPTION_LPH } from '../pack-weight';
import { DEFAULT_FOOD_CONSUMPTION_KG_PER_DAY } from '../resupply-cadence';
import { normalizeWaypointCategory, type WaypointCategoryId } from '../waypoint-categories';
import {
	filterActiveEntries,
	isSeasonalStatusDefaultEnabled,
	type SeasonalStatusEntry,
	type SeasonalStatusFile,
} from '../seasonal-status';
import { newId, type JournalEntry } from '@/lib/user-waypoints';
import { sanitizeWaterLog, waterLogToday, type WaterLogEntry, type WaterStatus } from '../water-log';
import { normalizePoiNote, sanitizePoiNotes } from '../poi-notes';
import { sanitizeNavTarget, type NavTarget } from '../nav-target';

/** Module-level abort controller for tile downloads - one download at a time. */
let tilePrecacheAbortController: AbortController | null = null;

/** Last time a GPS-source predictive pre-cache check was evaluated. Module-scoped so the debounce survives selector subscriptions. */
let lastPredictiveCheckAt = 0;
const PREDICTIVE_GPS_DEBOUNCE_MS = 30_000;

/** Persisted GPS fixes older than this are dropped on rehydration so a stale fix
 *  from a prior trip is never presented in the emergency panel as the current
 *  last-known position. */
const LAST_KNOWN_FIX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Validate a last-known GPS fix rehydrated from localStorage before it reaches the
 *  emergency panel: tampered or corrupt values (non-finite/out-of-range coords, bad
 *  timestamp) and fixes older than LAST_KNOWN_FIX_MAX_AGE_MS are rejected so they
 *  cannot render as garbage coordinates or a misleadingly stale position. */
function isValidLastKnownFix(raw: unknown): raw is LastKnownFix {
	if (!raw || typeof raw !== 'object') return false;
	const { lat, lng, timestamp, accuracy } = raw as Record<string, unknown>;
	if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return false;
	if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return false;
	if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return false;
	if (accuracy !== undefined && (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0))
		return false;
	return Date.now() - timestamp <= LAST_KNOWN_FIX_MAX_AGE_MS;
}

/** Sanitize a rehydrated SOS card from localStorage: keep only known fields with
 *  non-empty string values, length-capped. Rejects tampered/garbage shapes so the
 *  emergency panel only ever renders clean on-device text. */
function sanitizeSosCard(raw: unknown): SosCard {
	if (!raw || typeof raw !== 'object') return {};
	const source = raw as Record<string, unknown>;
	const out: SosCard = {};
	for (const key of SOS_CARD_FIELDS) {
		const value = source[key];
		if (typeof value === 'string' && value.length > 0) out[key] = value.slice(0, SOS_CARD_FIELD_MAX_LEN);
	}
	return out;
}

/** Optional Up Next row toggles: expand "More ahead" when enabling any; collapse when all off. */
function patchOptionalUpNextToggles(
	state: Pick<
		MapStoreState,
		'upNextShowFood' | 'upNextShowAtm' | 'upNextShowViewpoint' | 'upNextShowPharmacy' | 'upNextMoreExpanded'
	>,
	patch: Partial<
		Pick<MapStoreState, 'upNextShowFood' | 'upNextShowAtm' | 'upNextShowViewpoint' | 'upNextShowPharmacy'>
	>,
): Pick<
	MapStoreState,
	'upNextShowFood' | 'upNextShowAtm' | 'upNextShowViewpoint' | 'upNextShowPharmacy' | 'upNextMoreExpanded'
> {
	const upNextShowFood = patch.upNextShowFood ?? state.upNextShowFood;
	const upNextShowAtm = patch.upNextShowAtm ?? state.upNextShowAtm;
	const upNextShowViewpoint = patch.upNextShowViewpoint ?? state.upNextShowViewpoint;
	const upNextShowPharmacy = patch.upNextShowPharmacy ?? state.upNextShowPharmacy;
	const enabling =
		patch.upNextShowFood === true ||
		patch.upNextShowAtm === true ||
		patch.upNextShowViewpoint === true ||
		patch.upNextShowPharmacy === true;
	const anyOn = upNextShowFood || upNextShowAtm || upNextShowViewpoint || upNextShowPharmacy;
	let upNextMoreExpanded = state.upNextMoreExpanded;
	if (enabling) upNextMoreExpanded = true;
	else if (!anyOn) upNextMoreExpanded = false;
	return { upNextShowFood, upNextShowAtm, upNextShowViewpoint, upNextShowPharmacy, upNextMoreExpanded };
}

/**
 * Creates the persisted map store. Receives getMainStore so it does not import the main store at module init (avoids circular deps).
 */
export function createMapStore(getMainStore: () => StoreState): UseBoundStore<StoreApi<MapStoreState>> {
	return create<MapStoreState>()(
		persist(
			(set, get) => {
				/** Fire-and-forget POI asset prefetch invoked after a successful
				 *  full-corridor download. Loads the entire POI dataset, runs the
				 *  prefetch with a 2-minute timeout, and bumps `poiPrefetchVersion`
				 *  so panels can refresh their counts. Partial failures are
				 *  recorded in `poiPrefetchSkipped` so the cache panel can tell
				 *  the user some popups may be incomplete offline; a hard failure
				 *  records every asset as skipped. Scoped to the store factory so
				 *  all cache orchestration lives inside `useMapStore` actions. */
				async function prefetchPoiAssetsAfterDownload(): Promise<void> {
					const file = await loadPois();
					if (!file?.pois?.length) return;
					try {
						// AbortSignal.timeout fallback: a bare `new AbortController().signal`
						// never fires, which would let the prefetch run unbounded on
						// browsers without timeout support. Arm the controller manually.
						let signal: AbortSignal;
						let timeoutId: ReturnType<typeof setTimeout> | null = null;
						if (typeof AbortSignal.timeout === 'function') {
							signal = AbortSignal.timeout(120_000);
						} else {
							const controller = new AbortController();
							timeoutId = setTimeout(() => controller.abort(), 120_000);
							signal = controller.signal;
						}
						const summary = await prefetchPoiAssets(file.pois, signal);
						if (timeoutId) clearTimeout(timeoutId);
						set({ poiPrefetchSkipped: summary.cancelled ? null : summary.skipped });
					} catch {
						// Hard failure (e.g. Cache Storage unavailable): flag rather than swallow.
						set({ poiPrefetchSkipped: file.pois.length });
					}
					set((s) => ({ poiPrefetchVersion: s.poiPrefetchVersion + 1 }));
				}

				/** Fire-and-forget corridor-scoped POI asset prefetch invoked
				 *  after a successful predictive tile run. Uses the slice the
				 *  caller already cached so we don't hit storage for POIs the
				 *  user is unlikely to encounter. Same abort signal as the
				 *  predictive run, so a direction change cancels both in one
				 *  motion. */
				async function prefetchCorridorPoisAfterPredictive(
					slice: PredictivePrecacheSlicePoint[],
					signal: AbortSignal,
				): Promise<void> {
					const ran = await prefetchPoisAlongSlice(slice, signal);
					if (ran) set((s) => ({ poiPrefetchVersion: s.poiPrefetchVersion + 1 }));
				}

				return {
					selectedTrail: null,
					setSelectedTrail: (id: string | null) => set({ selectedTrail: id }),

					trailData: null,
					setTrailData: (data: GeoJSON.FeatureCollection | null) => set({ trailData: data }),

					startPoint: null,
					endPoint: null,
					totalDistance: 0,
					elevationGain: 0,
					elevationLoss: 0,

					rawGpxData: null,
					setRawGpxData: (data: string | null) => set({ rawGpxData: data }),
					gpxElevationPoints: [],
					setGpxElevationPoints: (points: { lat: number; lng: number; elevation: number }[]) =>
						set({ gpxElevationPoints: points }),
					gpxLoaded: false,
					setGpxLoaded: (loaded: boolean) => set({ gpxLoaded: loaded }),
					gpxLoadFailed: false,
					setGpxLoadFailed: (failed: boolean) => set({ gpxLoadFailed: failed }),
					reloadTrailRequested: 0,
					setReloadTrailRequested: (timestamp: number) => set({ reloadTrailRequested: timestamp }),

					units: config.units,
					setUnits: (units: UnitSystem) => set({ units }),
					distancePrecision: config.distancePrecision,
					setDistancePrecision: (precision: number) => set({ distancePrecision: precision }),

					direction: config.direction,
					setDirection: (direction: TrailDirection) => {
						// Reverse-of-travel invalidates the predictive throttle: a NOBO 0-20 km bucket
						// is a different forward corridor than a SOBO 0-20 km bucket. Clearing the
						// bucket set + debounce timestamp lets the next GPS update re-arm a run.
						if (get().direction !== direction) {
							resetPredictivePrecacheBuckets();
							lastPredictiveCheckAt = 0;
						}
						set({ direction });
					},

					showBoundary: config.showBoundary,
					setShowBoundary: (show: boolean) => set({ showBoundary: show }),
					showTileBoundary: config.showTileBoundary,
					setShowTileBoundary: (show: boolean) => set({ showTileBoundary: show }),

					isRulerEnabled: config.rulerEnabled,
					setRulerEnabled: (enabled: boolean) => set({ isRulerEnabled: enabled }),

					showRadarOverlay: false,
					setShowRadarOverlay: (show: boolean) => set({ showRadarOverlay: show }),
					radarFrames: [],
					setRadarFrames: (frames: Array<{ time: number; url: string }>) => set({ radarFrames: frames }),
					radarFrameIndex: 0,
					setRadarFrameIndex: (index: number) => set({ radarFrameIndex: index }),
					radarPlaying: false,
					setRadarPlaying: (playing: boolean) => set({ radarPlaying: playing }),
					rulerRange: null,
					setRulerRange: (range: RulerRange | null) => set({ rulerRange: range }),

					userLocation: null,
					lastKnownFix: null,
					sosCard: {},
					setSosCard: (card: SosCard) => set({ sosCard: card }),
					isLocating: false,
					permissionStatus: null,
					locationError: null,
					showUserMarker: config.showUserMarker,
					setUserLocation: (location: { lat: number; lng: number; accuracy?: number } | null) =>
						set({ userLocation: location }),
					setIsLocating: (isLocating: boolean) => set({ isLocating }),
					setPermissionStatus: (status: 'granted' | 'denied' | 'prompt' | null) => {
						const prev = get().permissionStatus;
						const updates: { permissionStatus: typeof status; showUserMarker?: boolean } = {
							permissionStatus: status,
						};
						if (status === 'granted' && prev !== 'granted') {
							updates.showUserMarker = true;
						}
						set(updates);
					},
					setLocationError: (error: { code: number; message: string } | null) => set({ locationError: error }),
					setShowUserMarker: (show: boolean) => set({ showUserMarker: show }),
					fakeUserLocationEnabled: false,
					setFakeUserLocationEnabled: (enabled: boolean) => {
						set({ fakeUserLocationEnabled: enabled });
						if (enabled) {
							const loc = getRandomLocationInBoundary();
							const location = { lat: loc.lat, lng: loc.lng, accuracy: 50 };
							set({
								userLocation: location,
								permissionStatus: 'granted' as const,
							});
							const main = getMainStore();
							main.setUserLocation(location);
							main.forceCalculateClosestPointFromLocation?.(location);
						} else {
							set({ userLocation: null });
							getMainStore().setUserLocation(null);
						}
					},
					setFakeUserLocation: () => {
						const loc = getRandomLocationInBoundary();
						const location = { lat: loc.lat, lng: loc.lng, accuracy: 50 };
						set({
							userLocation: location,
							permissionStatus: 'granted' as const,
						});
						const main = getMainStore();
						main.setUserLocation(location);
						main.forceCalculateClosestPointFromLocation?.(location);
					},
					setFakeUserLocationOnTrail: async () => {
						let points: { lat: number; lng: number }[] = [];
						const mainState = getMainStore();
						const enhanced = mainState.enhancedTrailPoints ?? [];
						const trailPts = mainState.trailPoints ?? [];
						if (enhanced.length > 0) {
							points = enhanced;
						} else if (trailPts.length > 0) {
							points = trailPts.map((pt: { lat: number; lng: number }) => ({ lat: pt.lat, lng: pt.lng }));
						}
						if (points.length === 0) {
							const { fetchAndParseTrailPoints } = await import('../gpx-cache');
							points = await fetchAndParseTrailPoints();
						}
						if (points.length === 0) return;
						const idx = Math.floor(Math.random() * points.length);
						const { lat, lng } = points[idx];
						const location = { lat, lng, accuracy: 50 };
						set({
							fakeUserLocationEnabled: true,
							userLocation: location,
							permissionStatus: 'granted' as const,
						});
						const main = getMainStore();
						main.setUserLocation(location);
						main.forceCalculateClosestPointFromLocation?.(location);
					},

					darkMode: config.darkMode,
					setDarkMode: (enabled: boolean) => set({ darkMode: enabled }),
					batterySaverMode: config.batterySaverMode,
					setBatterySaverMode: (enabled: boolean) => set({ batterySaverMode: enabled }),
					compassEnabled: false,
					setCompassEnabled: (enabled: boolean) => set({ compassEnabled: enabled }),
					keepScreenOn: false,
					setKeepScreenOn: (enabled: boolean) => set({ keepScreenOn: enabled }),
					offRouteAlertEnabled: false,
					setOffRouteAlertEnabled: (enabled: boolean) => set({ offRouteAlertEnabled: enabled }),
					largeTouchTargets: config.largeTouchTargets,
					setLargeTouchTargets: (enabled: boolean) => set({ largeTouchTargets: enabled }),
					uiTextScale: config.uiTextScale,
					setUiTextScale: (scale: UiTextScale) => set({ uiTextScale: scale }),
					showSections: config.showSections,
					gradeTintedTrail: config.gradeTintedTrail,
					surfaceColoured: config.surfaceColoured,
					sacColoured: config.sacColoured,
					showDistanceMarkers: config.showDistanceMarkers,
					// All four trail-style modes are mutually exclusive: enabling one
					// flips the other three off in the same set() call. The setters
					// guard against unnecessary writes by only mentioning the others
					// when the new value would change them.
					setShowSections: (show: boolean): void => {
						set({
							showSections: show,
							...(show && { gradeTintedTrail: false, surfaceColoured: false, sacColoured: false }),
						});
					},
					setGradeTintedTrail: (enabled: boolean): void => {
						set({
							gradeTintedTrail: enabled,
							...(enabled && { showSections: false, surfaceColoured: false, sacColoured: false }),
						});
					},
					setSurfaceColoured: (enabled: boolean): void => {
						set({
							surfaceColoured: enabled,
							...(enabled && { showSections: false, gradeTintedTrail: false, sacColoured: false }),
						});
					},
					setSacColoured: (enabled: boolean): void => {
						set({
							sacColoured: enabled,
							...(enabled && { showSections: false, gradeTintedTrail: false, surfaceColoured: false }),
						});
					},
					setShowDistanceMarkers: (show: boolean): void => {
						set({ showDistanceMarkers: show });
					},
					baseMapProvider: config.baseMapProvider,
					setBaseMapProvider: (provider: string) => set({ baseMapProvider: provider }),

					isMapFullscreen: false,
					setMapFullscreen: (fullscreen: boolean) => set({ isMapFullscreen: fullscreen }),

					openPanel: null,
					setOpenPanel: (id: string | null) => set({ openPanel: id }),
					togglePanel: (id: string) => set((s: MapStoreState) => ({ openPanel: s.openPanel === id ? null : id })),
					closePanel: () => set({ openPanel: null }),

					onboardingSeen: false,
					markOnboardingSeen: () => set({ onboardingSeen: true }),

					// ── Offline / tile cache ───────────────────────────────────────────
					isOffline: false,
					setIsOffline: (offline: boolean) => set({ isOffline: offline }),

					initOfflineDetection: () => {
						if (typeof window === 'undefined') return;
						const update = (): void => {
							set({ isOffline: !navigator.onLine });
						};
						update();
						window.addEventListener('online', update);
						window.addEventListener('offline', update);
					},

					tileCacheDownloading: false,
					tileCacheDone: 0,
					tileCacheTotal: 0,
					tileCacheError: null,
					tileCacheFailed: 0,
					tileCacheFailedUrls: [],
					tileCacheMeta: null,
					autoSync: config.autoSync,
					predictivePrecache: config.predictivePrecache,
					offlineHighDetailAheadEnabled: false,
					poiPrefetchVersion: 0,
					// Session-scoped on purpose (not in partialize): a stale skip count
					// from a previous session would be misleading.
					poiPrefetchSkipped: null,

					startTileDownload: async (points, providerName, opts) => {
						if (typeof window === 'undefined') return;
						if (!isProviderCacheable(providerName)) {
							set({ tileCacheError: 'not_cacheable' });
							return;
						}
						const urlTemplate = getTileUrlTemplate(providerName);
						if (!urlTemplate) {
							set({ tileCacheError: 'no_template' });
							return;
						}
						const storage = await estimateStorage();
						if (!storage.available) {
							set({ tileCacheError: 'quota_exceeded' });
							return;
						}
						// User-initiated download: request durable storage so the browser does not
						// evict the corridor under pressure. Skip autoSync (user already opted in).
						if (opts?.source !== 'autoSync') void requestPersistentStorage();
						const urls = generateTrailTileUrls(points, urlTemplate, PRECACHE_ZOOM_MIN, PRECACHE_ZOOM_MAX);
						const providerKey = getProviderCacheKey(providerName);
						tilePrecacheAbortController?.abort();
						const controller = new AbortController();
						tilePrecacheAbortController = controller;
						set({
							tileCacheDownloading: true,
							tileCacheDone: 0,
							tileCacheTotal: urls.length,
							tileCacheError: null,
							tileCacheFailed: 0,
							tileCacheFailedUrls: [],
						});
						const result = await precacheTiles(
							urls,
							(done, total) => set({ tileCacheDone: done, tileCacheTotal: total }),
							controller.signal,
						);
						tilePrecacheAbortController = null;
						if (!result.cancelled) {
							const existingMeta = get().tileCacheMeta;
							const meta: TileCacheMeta = {
								cachedAt: Date.now(),
								tileCount: result.done,
								zoomMin: PRECACHE_ZOOM_MIN,
								zoomMax: existingMeta?.hasHighDetailAhead ? PRECACHE_ZOOM_MAX_HIGH : PRECACHE_ZOOM_MAX,
								providerKey,
								...(existingMeta?.hasHighDetailAhead ? { hasHighDetailAhead: true } : {}),
							};
							await saveTileCacheMeta(providerKey, meta);
							const isManualDownload = opts?.source !== 'autoSync';
							const offlineNudgeEligible =
								isManualDownload &&
								result.done > 0 &&
								!isStandalone() &&
								canShowPwaInstallPrompt() &&
								canShowOfflineInstallNudge();
							set({
								tileCacheMeta: meta,
								tileCacheDownloading: false,
								tileCacheFailed: result.failed,
								tileCacheFailedUrls: result.failedUrls,
								// A freshly cached corridor is never stale - dismiss the nag for
								// both the manual "Re-download" path and the silent self-heal.
								showStaleCacheNotification: false,
								...(isManualDownload && result.done > 0 ? { tileDownloadCompleteToast: true } : {}),
								...(offlineNudgeEligible ? { pwaInstallTrigger: 'offlineDownload' as const } : {}),
							});
							// Fire-and-forget POI asset prefetch on the full dataset.
							// The user explicitly opted into offline mode by triggering
							// the corridor download, so we mirror that intent for
							// thumbnails + Wikipedia summaries. Failures are silent.
							void prefetchPoiAssetsAfterDownload();
						} else {
							set({ tileCacheDownloading: false });
						}
					},

					cancelTileDownload: () => {
						tilePrecacheAbortController?.abort();
						tilePrecacheAbortController = null;
						set({ tileCacheDownloading: false });
					},

					retryFailedTiles: async () => {
						if (typeof window === 'undefined') return;
						const failed = get().tileCacheFailedUrls;
						if (failed.length === 0 || get().tileCacheDownloading) return;
						tilePrecacheAbortController?.abort();
						const controller = new AbortController();
						tilePrecacheAbortController = controller;
						set({
							tileCacheDownloading: true,
							tileCacheDone: 0,
							tileCacheTotal: failed.length,
							tileCacheError: null,
						});
						// Re-fetch only the misses; the live cache-count effect re-queries
						// the real Cache Storage size once downloading flips back to false.
						const result = await precacheTiles(
							failed,
							(done, total) => set({ tileCacheDone: done, tileCacheTotal: total }),
							controller.signal,
						);
						tilePrecacheAbortController = null;
						if (!result.cancelled) {
							set({
								tileCacheDownloading: false,
								tileCacheFailed: result.failed,
								tileCacheFailedUrls: result.failedUrls,
							});
						} else {
							set({ tileCacheDownloading: false });
						}
					},

					clearTileCacheForProvider: async (providerKey?: string) => {
						if (typeof window === 'undefined') return;
						await clearTileCache(providerKey);
						set({ tileCacheMeta: null, tileCacheDone: 0, tileCacheTotal: 0 });
					},

					loadTileCacheMeta: async (providerKey: string) => {
						if (typeof window === 'undefined') return;
						const meta = await getTileCacheMeta(providerKey);
						set({ tileCacheMeta: meta });
					},

					setAutoSync: (enabled: boolean) => set({ autoSync: enabled }),

					setPredictivePrecache: (enabled: boolean) => {
						set({ predictivePrecache: enabled });
						if (!enabled) abortPredictivePrecache();
					},

					setOfflineHighDetailAheadEnabled: (enabled: boolean) => {
						set({ offlineHighDetailAheadEnabled: enabled });
					},

					startHighDetailAheadDownload: async () => {
						if (typeof window === 'undefined') return;
						const state = get();
						if (!state.tileCacheMeta) return;
						const providerName = state.baseMapProvider;
						if (!isProviderCacheable(providerName)) {
							set({ tileCacheError: 'not_cacheable' });
							return;
						}
						const urlTemplate = getTileUrlTemplate(providerName);
						if (!urlTemplate) {
							set({ tileCacheError: 'no_template' });
							return;
						}
						const main = getMainStore();
						const points = main.enhancedTrailPoints ?? [];
						if (points.length < 2) return;

						const storage = await estimateStorage();
						if (!storage.available) {
							set({ tileCacheError: 'quota_exceeded' });
							return;
						}
						// User-initiated high-detail download: request durable storage too.
						void requestPersistentStorage();

						const slice = buildHighDetailAheadSlice({
							points,
							direction: state.direction,
							userLocation: state.userLocation,
							closestPoint: main.closestPoint,
							offTrailThresholdM: TRAIL_OFF_TRAIL_THRESHOLD_M,
						});
						if (slice.length < 2) return;

						const urls = generateAheadHighDetailTileUrls(slice, urlTemplate);
						if (!urls.length) return;

						const providerKey = getProviderCacheKey(providerName);
						tilePrecacheAbortController?.abort();
						const controller = new AbortController();
						tilePrecacheAbortController = controller;
						set({
							tileCacheDownloading: true,
							tileCacheDone: 0,
							tileCacheTotal: urls.length,
							tileCacheError: null,
							tileCacheFailed: 0,
							tileCacheFailedUrls: [],
						});
						const result = await precacheTiles(
							urls,
							(done, total) => set({ tileCacheDone: done, tileCacheTotal: total }),
							controller.signal,
						);
						tilePrecacheAbortController = null;
						if (!result.cancelled) {
							const existingMeta = state.tileCacheMeta;
							const meta: TileCacheMeta = {
								cachedAt: existingMeta?.cachedAt ?? Date.now(),
								tileCount: (existingMeta?.tileCount ?? 0) + result.done,
								zoomMin: existingMeta?.zoomMin ?? PRECACHE_ZOOM_MIN,
								zoomMax: PRECACHE_ZOOM_MAX_HIGH,
								providerKey,
								hasHighDetailAhead: true,
							};
							await saveTileCacheMeta(providerKey, meta);
							set({
								tileCacheMeta: meta,
								tileCacheDownloading: false,
								tileCacheFailed: result.failed,
								tileCacheFailedUrls: result.failedUrls,
								...(result.done > 0 ? { tileDownloadCompleteToast: true } : {}),
							});
						} else {
							set({ tileCacheDownloading: false });
						}
					},

					/** Single entry point for SW `TILE_QUOTA_EXCEEDED` - sets the error flag and aborts the predictive run. */
					handleQuotaExceeded: () => {
						set({ tileCacheError: 'quota_exceeded' });
						abortPredictivePrecache();
					},

					/**
					 * Evaluates favourable conditions and either starts a predictive run or aborts the
					 * in-flight one. Conditions: toggle on, active provider's offline tiles are initialised
					 * (proxied by `tileCacheMeta !== null` - a prior baseline download exists), no recent
					 * quota error, GPS active and on-trail, Wi-Fi connection, battery ≥ 50 % or charging.
					 * Battery values are read locally only and never transmitted.
					 *
					 * Inexpensive synchronous guards run before the async `getBattery()` so the high-frequency
					 * GPS path doesn't pay an IPC round-trip for calls that would fail trivially.
					 */
					maybeRunPredictivePrecache: async (opts) => {
						if (typeof window === 'undefined') return;
						const source = opts?.source ?? 'gps';
						const state = get();

						// Fast-fail synchronous guards. If any fails, also abort any in-flight run (REQ-005).
						if (
							!state.predictivePrecache ||
							!state.tileCacheMeta ||
							!isProviderCacheable(state.baseMapProvider) ||
							state.tileCacheError === 'quota_exceeded'
						) {
							abortPredictivePrecache();
							return;
						}

						// GPS-source debounce. Change-event sources always re-evaluate.
						if (source === 'gps') {
							const now = Date.now();
							if (now - lastPredictiveCheckAt < PREDICTIVE_GPS_DEBOUNCE_MS) return;
							lastPredictiveCheckAt = now;
						}

						// GPS / on-trail (inexpensive sync). Off-trail or unknown position → abort + stop.
						const main = getMainStore();
						const closest = main.closestPoint;
						const enhanced = main.enhancedTrailPoints ?? [];
						if (!state.userLocation || !closest || closest.distance > TRAIL_OFF_TRAIL_THRESHOLD_M || !enhanced.length) {
							abortPredictivePrecache();
							return;
						}

						// Wi-Fi only - cellular pre-cache is explicitly out of scope. When the Network
						// Information API is absent, `conn?.type` is undefined and this check aborts
						// as intended.
						const conn = (navigator as NavigatorWithConnection).connection;
						if (conn?.type !== 'wifi') {
							abortPredictivePrecache();
							return;
						}

						// Battery (async, evaluated last). Missing API → unfavourable.
						const navWithBattery = navigator as NavigatorWithBattery;
						if (typeof navWithBattery.getBattery !== 'function') {
							abortPredictivePrecache();
							return;
						}
						let battery: { level: number; charging: boolean };
						try {
							battery = await navWithBattery.getBattery();
						} catch {
							abortPredictivePrecache();
							return;
						}
						if (!battery.charging && battery.level < 0.5) {
							abortPredictivePrecache();
							return;
						}

						// All favourable - start (or restart) a run. The tile-cache
						// utility returns the corridor slice so we can fire the
						// POI prefetch ourselves; tile-cache.ts has no dependency
						// on the POI layer.
						const fromIdx = findNearestPointIndex(enhanced, closest.distanceFromStart);
						void (async (): Promise<void> => {
							const runResult = await runPredictivePrecache({
								points: enhanced,
								fromIdx,
								direction: state.direction,
								providerName: state.baseMapProvider,
							});
							if (!runResult) return;
							if (runResult.signal.aborted) return;
							void prefetchCorridorPoisAfterPredictive(runResult.slice, runResult.signal);
						})();
					},

					showStaleCacheNotification: false,
					setStaleCacheNotification: (show: boolean): void => {
						set({ showStaleCacheNotification: show });
					},
					initStaleCacheCheck: async (): Promise<void> => {
						if (typeof window === 'undefined') return;
						try {
							const providerKey = getProviderCacheKey(get().baseMapProvider);
							const meta = await getTileCacheMeta(providerKey);
							// Auto-sync silently self-heals a stale cache when online and off
							// battery saver, so only nag the user when that path will not run.
							const selfHealEligible = get().autoSync && !get().batterySaverMode && navigator.onLine;
							set({ showStaleCacheNotification: isCacheStale(meta) && !selfHealEligible });
						} catch {
							// Storage unavailable or corrupted - leave flag false
							set({ showStaleCacheNotification: false });
						}
					},

					selfHealStaleTiles: async (): Promise<void> => {
						if (typeof window === 'undefined') return;
						const state = get();
						// Gates: opted in (auto-sync), online, not conserving battery, and no
						// download already running. Battery saver falls back to the nag.
						if (!state.autoSync || state.batterySaverMode || state.tileCacheDownloading) return;
						if (!navigator.onLine) return;
						const providerName = state.baseMapProvider;
						if (!isProviderCacheable(providerName)) return;
						const points = getMainStore().enhancedTrailPoints ?? [];
						if (points.length < 2) return;
						const providerKey = getProviderCacheKey(providerName);
						let meta: TileCacheMeta | null;
						try {
							meta = await getTileCacheMeta(providerKey);
						} catch {
							// Storage unavailable or corrupted - degrade to a no-op (the call
							// sites are fire-and-forget, so never leak an unhandled rejection).
							return;
						}
						// Only heal an existing corridor that has aged out; the first
						// baseline download stays a deliberate, manual action.
						if (!meta || !isCacheStale(meta)) return;
						// Re-check after the async meta read: a manual download may have begun
						// in the meantime, and startTileDownload aborts the shared controller.
						if (get().tileCacheDownloading) return;
						await get().startTileDownload(points, providerName, { source: 'autoSync' });
					},

					pwaInstallTrigger: null,
					clearPwaInstallTrigger: (): void => {
						set({ pwaInstallTrigger: null });
					},
					tileDownloadCompleteToast: false,
					clearTileDownloadCompleteToast: (): void => {
						set({ tileDownloadCompleteToast: false });
					},

					processTrailData: (
						points: LatLng[],
						elevationPoints: { lat: number; lng: number; elevation: number }[],
						startPoint: LatLng | null,
						endPoint: LatLng | null,
						totalDistance: number,
						elevationGain: number,
						elevationLoss: number,
					) => {
						set({
							startPoint,
							endPoint,
							totalDistance,
							elevationGain,
							elevationLoss,
							gpxElevationPoints: elevationPoints,
							gpxLoaded: true,
						});
					},

					getCurrentLocation: async () => {
						if (get().fakeUserLocationEnabled) {
							const loc = get().userLocation;
							return loc ? { lat: loc.lat, lng: loc.lng } : { lat: 0, lng: 0 };
						}
						set({ isLocating: true, locationError: null });

						try {
							const locationService = LocationService.getInstance();
							const options = get().batterySaverMode ? { maximumAge: 60000, enableHighAccuracy: false } : {};
							const result = await locationService.getCurrentLocation(options);

							if (result.lat && result.lng) {
								set({
									userLocation: {
										lat: result.lat,
										lng: result.lng,
										accuracy: result.accuracy ?? undefined,
									},
									isLocating: false,
								});

								if (result.permissionStatus) {
									set({ permissionStatus: result.permissionStatus });
								}
							} else if (result.error) {
								set({
									locationError: result.error,
									isLocating: false,
									permissionStatus: result.permissionStatus || 'prompt',
								});
							}

							return {
								lat: result.lat,
								lng: result.lng,
								...(result.error !== null && { error: result.error }),
							};
						} catch (error) {
							const errorObj = toLocationError(error, 'Unknown error getting location');
							set({ locationError: errorObj, isLocating: false });
							return { lat: 0, lng: 0, error: errorObj };
						}
					},

					initLocationService: () => {
						if (typeof window === 'undefined') {
							return;
						}

						const locationService = LocationService.getInstance();

						locationService.setStoreUpdater({
							setPermissionStatus: (status) => set({ permissionStatus: status }),
							setUserLocation: (location) => {
								if (get().fakeUserLocationEnabled) {
									return;
								}
								set({ userLocation: location });

								const mainStore = getMainStore();
								mainStore.setUserLocation(location);
								// Recalculate immediately to avoid the tooltip flicker (no null window).
								mainStore.calculateClosestPoint?.();
							},
							setIsLocating: (isLocating) => set({ isLocating }),
							setLocationError: (error) => set({ locationError: error }),
							setLastKnownFix: (fix) => {
								// Skip fake/demo fixes; only real GPS should seed the persisted last-known fix.
								if (get().fakeUserLocationEnabled) return;
								set({ lastKnownFix: fix });
							},
						});

						locationService
							.checkPermission()
							.then((result) => {
								if (get().fakeUserLocationEnabled) {
									return;
								}
								get().setPermissionStatus(result.state);
							})
							.catch((error) => {
								console.error('Error checking initial permission:', error);
								if (get().fakeUserLocationEnabled) {
									return;
								}
								set({ permissionStatus: 'denied' });
							});
					},

					requestLocationPermission: async () => {
						set({ isLocating: true });

						try {
							const locationService = LocationService.getInstance();
							const result = await locationService.requestPermission();
							get().setPermissionStatus(result.state);

							if (result.state === 'granted') {
								await get().getCurrentLocation();
							}
						} catch (error) {
							console.error('Error requesting location permission:', error);
							set({ locationError: toLocationError(error, 'Unknown error requesting permission') });
						} finally {
							set({ isLocating: false });
						}
					},

					walkingPaceKmh: config.walkingPaceKmh,
					setWalkingPaceKmh: (pace: number): void => {
						set({ walkingPaceKmh: pace });
					},

					paceFactor: config.paceFactor,
					setPaceFactor: (factor: number): void => {
						set({ paceFactor: clampPaceFactor(factor) });
					},

					packBaseWeightKg: null,
					setPackBaseWeightKg: (kg: number | null): void => {
						set({ packBaseWeightKg: kg });
					},
					waterConsumptionLph: DEFAULT_WATER_CONSUMPTION_LPH,
					setWaterConsumptionLph: (lph: number): void => {
						set({ waterConsumptionLph: lph });
					},
					foodConsumptionKgPerDay: DEFAULT_FOOD_CONSUMPTION_KG_PER_DAY,
					setFoodConsumptionKgPerDay: (kgPerDay: number): void => {
						set({ foodConsumptionKgPerDay: kgPerDay });
					},
					packEtaAdjust: false,
					setPackEtaAdjust: (enabled: boolean): void => {
						set({ packEtaAdjust: enabled });
					},
					packGearList: null,
					setPackGearList: (list): void => {
						set({ packGearList: list });
					},
					pushAlertsEnabled: false,
					setPushAlertsEnabled: (enabled: boolean): void => {
						set({ pushAlertsEnabled: enabled });
					},
					waymarkedTrailsOverlay: false,
					setWaymarkedTrailsOverlay: (enabled: boolean): void => {
						set({ waymarkedTrailsOverlay: enabled });
					},
					shareShortLinks: config.shareShortLinks,
					setShareShortLinks: (enabled: boolean): void => {
						set({ shareShortLinks: enabled });
					},
					shareCopyToast: null,
					showShareCopyToast: (feedback): void => {
						set((s) => ({
							shareCopyToast: {
								status: feedback.status,
								short: feedback.short,
								nonce: (s.shareCopyToast?.nonce ?? 0) + 1,
							},
						}));
					},
					clearShareCopyToast: (): void => {
						set({ shareCopyToast: null });
					},

					userWaypoints: [],
					addUserWaypoint: (wp): void => {
						const category = normalizeWaypointCategory(wp.category);
						set((s) => ({
							userWaypoints: [...s.userWaypoints, { ...wp, category }],
							lastWaypointCategory: category,
						}));
					},
					updateUserWaypoint: (id, patch): void => {
						set((s) => {
							const nextCategory = patch.category !== undefined ? normalizeWaypointCategory(patch.category) : undefined;
							return {
								userWaypoints: s.userWaypoints.map((w) =>
									w.id === id ? { ...w, ...patch, ...(nextCategory !== undefined && { category: nextCategory }) } : w,
								),
								...(nextCategory !== undefined && { lastWaypointCategory: nextCategory }),
							};
						});
					},
					removeUserWaypoint: (id): void => {
						set((s) => ({ userWaypoints: s.userWaypoints.filter((w) => w.id !== id) }));
					},
					pendingOpenWaypointId: null,
					requestOpenWaypoint: (id: string): void => {
						set({ pendingOpenWaypointId: id });
					},
					clearPendingOpenWaypoint: (): void => {
						set({ pendingOpenWaypointId: null });
					},
					lastWaypointCategory: 'generic',
					setLastWaypointCategory: (category): void => {
						set({ lastWaypointCategory: normalizeWaypointCategory(category) });
					},
					hiddenWaypointCategories: new Set(),
					toggleWaypointCategoryOnMap: (category): void => {
						const id = normalizeWaypointCategory(category);
						set((s) => {
							const next = new Set(s.hiddenWaypointCategories);
							if (next.has(id)) next.delete(id);
							else next.add(id);
							return { hiddenWaypointCategories: next };
						});
					},
					setHiddenWaypointCategories: (hidden): void => {
						set({ hiddenWaypointCategories: hidden });
					},

					journalEntries: [],
					addJournalEntry: (entry): void => {
						set((s) => ({ journalEntries: [...s.journalEntries, entry] }));
					},
					updateJournalEntry: (id, patch): void => {
						set((s) => ({
							journalEntries: s.journalEntries.map((e) => {
								if (e.id !== id) return e;
								const merged: JournalEntry = { ...e, ...patch };
								if ('trackLink' in patch && patch.trackLink === undefined) delete merged.trackLink;
								if ('startKm' in patch && patch.startKm === undefined) delete merged.startKm;
								if ('endKm' in patch && patch.endKm === undefined) delete merged.endKm;
								return merged;
							}),
						}));
					},
					removeJournalEntry: (id): void => {
						set((s) => ({
							journalEntries: s.journalEntries.filter((e) => e.id !== id),
							journalHighlightEntryId: s.journalHighlightEntryId === id ? null : s.journalHighlightEntryId,
							journalPreview: s.journalPreview?.entryId === id ? null : s.journalPreview,
						}));
					},
					journalHighlightEntryId: null,
					setJournalHighlightEntryId: (id: string | null): void => {
						set({ journalHighlightEntryId: id });
					},
					journalPreview: null,
					setJournalPreview: (preview): void => {
						set({
							journalPreview: preview,
							...(preview === null ? { journalHighlightEntryId: null } : {}),
						});
					},

					poiWaterLog: {},
					setPoiWaterStatus: (poiId: string, status: WaterStatus): void => {
						const entry: WaterLogEntry = { status, date: waterLogToday() };
						set((s) => ({ poiWaterLog: { ...s.poiWaterLog, [poiId]: entry } }));
					},
					clearPoiWaterStatus: (poiId: string): void => {
						set((s) => {
							if (!(poiId in s.poiWaterLog)) return {};
							const next = { ...s.poiWaterLog };
							delete next[poiId];
							return { poiWaterLog: next };
						});
					},

					poiNotes: {},
					setPoiNote: (poiId: string, text: string): void => {
						const normalized = normalizePoiNote(text);
						set((s) => {
							if (!normalized) {
								if (!(poiId in s.poiNotes)) return {};
								const next = { ...s.poiNotes };
								delete next[poiId];
								return { poiNotes: next };
							}
							return { poiNotes: { ...s.poiNotes, [poiId]: normalized } };
						});
					},
					clearPoiNote: (poiId: string): void => {
						set((s) => {
							if (!(poiId in s.poiNotes)) return {};
							const next = { ...s.poiNotes };
							delete next[poiId];
							return { poiNotes: next };
						});
					},

					navTarget: null,
					setNavTarget: (target: NavTarget): void => {
						const clean = sanitizeNavTarget(target);
						if (clean) set({ navTarget: clean });
					},
					clearNavTarget: (): void => {
						set({ navTarget: null });
					},

					gradeAdjustedEta: config.gradeAdjustedEta,
					setGradeAdjustedEta: (enabled: boolean): void => {
						set({ gradeAdjustedEta: enabled });
					},

					sunsetProjection: config.sunsetProjection,
					setSunsetProjection: (enabled: boolean): void => {
						set({ sunsetProjection: enabled });
					},

					stagePlan: null,
					setStagePlan: (plan: StagePlan): void => {
						set({ stagePlan: plan });
					},
					clearStagePlan: (): void => {
						set({ stagePlan: null });
					},
					importedTracks: [],

					addImportedTrack: (track: ImportedTrack): void => {
						set((state) => ({ importedTracks: [...state.importedTracks, track] }));
					},

					removeImportedTrack: async (id: string): Promise<void> => {
						await removeImportedTrack(id);
						set((state) => ({
							importedTracks: state.importedTracks.filter((t) => t.id !== id),
							// Prune the progress-toggle marker; the completed intervals
							// themselves stay (deleting a file should not erase hiked km).
							progressTrackIds: state.progressTrackIds.filter((tid) => tid !== id),
							progressPreviewTrackId: state.progressPreviewTrackId === id ? null : state.progressPreviewTrackId,
							progressPreviewIntervals: state.progressPreviewTrackId === id ? [] : state.progressPreviewIntervals,
							journalPreview: state.journalPreview?.trackId === id ? null : state.journalPreview,
						}));
					},

					progressTrackIds: [],
					addProgressTrackId: (id: string): void => {
						set((state) => ({
							progressTrackIds: state.progressTrackIds.includes(id)
								? state.progressTrackIds
								: [...state.progressTrackIds, id],
						}));
					},
					removeProgressTrackId: (id: string): void => {
						set((state) => ({ progressTrackIds: state.progressTrackIds.filter((tid) => tid !== id) }));
					},

					setImportedTracks: (tracks: ImportedTrack[]): void => {
						set({ importedTracks: tracks });
					},
					updateImportedTrack: (id, patch): void => {
						set((state) => ({
							importedTracks: state.importedTracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
						}));
						// Best-effort persistence: the in-memory update already succeeded, so a
						// storage write failure (quota exceeded, private-mode storage) is non-fatal.
						void persistImportedTrackPatch(id, patch).catch(() => {});
					},

					loadImportedTracksFromStorage: async (): Promise<void> => {
						if (typeof window === 'undefined') return;
						const tracks = await loadImportedTracks();
						set({ importedTracks: tracks });
					},

					hoveredImportedTrackId: null,
					setHoveredImportedTrackId: (id: string | null): void => {
						set({ hoveredImportedTrackId: id });
					},

					severeWeatherLayer: config.severeWeatherLayer,
					setSevereWeatherLayer: (enabled: boolean): void => {
						set({ severeWeatherLayer: enabled });
					},
					severeWeatherData: null,
					setSevereWeatherData: (data: GeoJSON.FeatureCollection | null): void => {
						set({ severeWeatherData: data });
					},

					completedIntervals: [],
					markCompleted: (startKm: number, endKm: number): void => {
						set({ completedIntervals: addInterval(get().completedIntervals, startKm, endKm) });
					},
					unmarkCompleted: (startKm: number, endKm: number): void => {
						set({ completedIntervals: removeInterval(get().completedIntervals, startKm, endKm) });
					},
					clearCompletion: (): void => {
						set({
							completedIntervals: [],
							progressTrackIds: [],
							progressPreviewTrackId: null,
							progressPreviewIntervals: [],
						});
					},
					completionAutoTrack: true,
					setCompletionAutoTrack: (enabled: boolean): void => {
						set({ completionAutoTrack: enabled });
					},
					showCompletionOverlay: true,
					setShowCompletionOverlay: (show: boolean): void => {
						set({ showCompletionOverlay: show });
					},
					progressPanelWaypointsOpen: true,
					setProgressPanelWaypointsOpen: (open: boolean): void => {
						set({ progressPanelWaypointsOpen: open });
					},
					progressPanelJournalOpen: true,
					setProgressPanelJournalOpen: (open: boolean): void => {
						set({ progressPanelJournalOpen: open });
					},
					settingsPanelOverlaysOpen: true,
					setSettingsPanelOverlaysOpen: (open: boolean): void => {
						set({ settingsPanelOverlaysOpen: open });
					},
					settingsPanelPackOpen: false,
					setSettingsPanelPackOpen: (open: boolean): void => {
						set({ settingsPanelPackOpen: open });
					},
					settingsPanelNotificationsOpen: false,
					setSettingsPanelNotificationsOpen: (open: boolean): void => {
						set({ settingsPanelNotificationsOpen: open });
					},
					settingsPanelOfflineOpen: null,
					setSettingsPanelOfflineOpen: (open: boolean | null): void => {
						set({ settingsPanelOfflineOpen: open });
					},
					settingsPanelImportsOpen: false,
					setSettingsPanelImportsOpen: (open: boolean): void => {
						set({ settingsPanelImportsOpen: open });
					},
					helpPanelBasicsOpen: true,
					setHelpPanelBasicsOpen: (open: boolean): void => {
						set({ helpPanelBasicsOpen: open });
					},
					helpPanelChartOpen: false,
					setHelpPanelChartOpen: (open: boolean): void => {
						set({ helpPanelChartOpen: open });
					},
					helpPanelGesturesOpen: false,
					setHelpPanelGesturesOpen: (open: boolean): void => {
						set({ helpPanelGesturesOpen: open });
					},
					helpPanelPlanningOpen: false,
					setHelpPanelPlanningOpen: (open: boolean): void => {
						set({ helpPanelPlanningOpen: open });
					},
					helpPanelOfflineOpen: false,
					setHelpPanelOfflineOpen: (open: boolean): void => {
						set({ helpPanelOfflineOpen: open });
					},
					helpPanelDemoOpen: true,
					setHelpPanelDemoOpen: (open: boolean): void => {
						set({ helpPanelDemoOpen: open });
					},
					poiListFiltersOpen: true,
					setPoiListFiltersOpen: (open: boolean): void => {
						set({ poiListFiltersOpen: open });
					},
					poiListSortOpen: true,
					setPoiListSortOpen: (open: boolean): void => {
						set({ poiListSortOpen: open });
					},
					poiListTagsOpen: false,
					setPoiListTagsOpen: (open: boolean): void => {
						set({ poiListTagsOpen: open });
					},
					poiListStarsOpen: false,
					setPoiListStarsOpen: (open: boolean): void => {
						set({ poiListStarsOpen: open });
					},
					poiListExportOpen: true,
					setPoiListExportOpen: (open: boolean): void => {
						set({ poiListExportOpen: open });
					},
					stagePlannerSetupOpen: true,
					setStagePlannerSetupOpen: (open: boolean): void => {
						set({ stagePlannerSetupOpen: open });
					},
					stagePlannerStagesOpen: false,
					setStagePlannerStagesOpen: (open: boolean): void => {
						set({ stagePlannerStagesOpen: open });
					},
					stagePlannerExportOpen: false,
					setStagePlannerExportOpen: (open: boolean): void => {
						set({ stagePlannerExportOpen: open });
					},
					settingsScrollTarget: null,
					openSettingsToImports: (): void => {
						set({
							openPanel: 'settings',
							settingsScrollTarget: 'imports',
							settingsPanelImportsOpen: true,
						});
					},
					clearSettingsScrollTarget: (): void => {
						set({ settingsScrollTarget: null });
					},
					helpScrollTarget: null,
					openHelpToPlanning: (): void => {
						set({
							openPanel: 'help',
							helpScrollTarget: 'planning',
							helpPanelPlanningOpen: true,
						});
					},
					clearHelpScrollTarget: (): void => {
						set({ helpScrollTarget: null });
					},
					progressPreviewTrackId: null,
					progressPreviewIntervals: [],
					setProgressPreview: (trackId: string | null, intervals: CompletionInterval[]): void => {
						set({ progressPreviewTrackId: trackId, progressPreviewIntervals: intervals });
					},

					showUpNext: true,
					setShowUpNext: (show: boolean): void => {
						set({ showUpNext: show });
					},
					upNextShowFood: false,
					setUpNextShowFood: (show: boolean): void => {
						set((state) => patchOptionalUpNextToggles(state, { upNextShowFood: show }));
					},
					upNextShowAtm: false,
					setUpNextShowAtm: (show: boolean): void => {
						set((state) => patchOptionalUpNextToggles(state, { upNextShowAtm: show }));
					},
					upNextShowViewpoint: false,
					setUpNextShowViewpoint: (show: boolean): void => {
						set((state) => patchOptionalUpNextToggles(state, { upNextShowViewpoint: show }));
					},
					upNextShowPharmacy: false,
					setUpNextShowPharmacy: (show: boolean): void => {
						set((state) => patchOptionalUpNextToggles(state, { upNextShowPharmacy: show }));
					},
					upNextMoreExpanded: false,
					setUpNextMoreExpanded: (expanded: boolean): void => {
						set({ upNextMoreExpanded: expanded });
					},

					aheadHorizonKm: 50,
					setAheadHorizonKm: (km: number): void => {
						const normalized = typeof km === 'number' ? km : Number(km);
						if (!isAheadHorizonKm(normalized)) return;
						set({ aheadHorizonKm: normalized });
					},
					pendingPoiListSort: null,
					requestPoiListAhead: (): void => {
						set({ pendingPoiListSort: 'ahead', openPanel: 'poiList' });
					},
					clearPendingPoiListSort: (): void => {
						set({ pendingPoiListSort: null });
					},

					walkSim: null,
					setWalkSim: (state): void => {
						set({ walkSim: state });
					},

					a11yAnnouncement: null,
					announce: (text): void => {
						set((state) => ({ a11yAnnouncement: { text, nonce: (state.a11yAnnouncement?.nonce ?? 0) + 1 } }));
					},

					demoModeActive: false,
					demoPersistSnapshot: null,
					enterDemoMode: (snapshot): void => {
						set({
							demoModeActive: true,
							demoPersistSnapshot: snapshot,
						});
					},

					// Mine-suspected areas: safety layer, ON by default (opt-out).
					mineAreasEnabled: config.mineAreasEnabled,
					setMineAreasEnabled: (enabled: boolean): void => {
						set({ mineAreasEnabled: enabled });
					},
					mineAreasFile: null,
					setMineAreasFile: (file): void => {
						set({ mineAreasFile: file });
					},

					trailOsmTagsFile: null,
					setTrailOsmTagsFile: (file): void => {
						set({ trailOsmTagsFile: file });
					},

					poisFile: null,
					setPoisFile: (file): void => {
						set({ poisFile: file });
					},
					poisLayerEnabled: config.poisLayerEnabled,
					setPoisLayerEnabled: (enabled: boolean): void => {
						set({ poisLayerEnabled: enabled });
					},
					poiDisclaimerDismissedAt: null,
					setPoiDisclaimerDismissedAt: (ts: number | null): void => {
						set({ poiDisclaimerDismissedAt: ts });
					},
					enabledPoiTypes: defaultEnabledPoiTypes,
					setEnabledPoiTypes: (types): void => {
						set({ enabledPoiTypes: types, poiFiltersUserModified: true });
					},
					togglePoiType: (type: string): void => {
						const current = get().enabledPoiTypes;
						const next = new Set(current);
						if (next.has(type)) next.delete(type);
						else next.add(type);
						set({ enabledPoiTypes: next, poiFiltersUserModified: true });
					},
					// Tags default to "no filter" (empty set). User picks chips in the
					// list panel to narrow the visible POIs by tag intersection.
					enabledPoiTags: new Set<string>(),
					setEnabledPoiTags: (tags): void => {
						set({ enabledPoiTags: tags, poiFiltersUserModified: true });
					},
					togglePoiTag: (tag: string): void => {
						const current = get().enabledPoiTags;
						const next = new Set(current);
						if (next.has(tag)) next.delete(tag);
						else next.add(tag);
						set({ enabledPoiTags: next, poiFiltersUserModified: true });
					},
					clearPoiTags: (): void => {
						set({ enabledPoiTags: new Set<string>(), poiFiltersUserModified: true });
					},
					includeRemotePois: config.includeRemotePois,
					setIncludeRemotePois: (enabled: boolean): void => {
						set({ includeRemotePois: enabled });
					},
					poiFiltersUserModified: false,
					resetPoiFiltersToDefaults: (): void => {
						set({ enabledPoiTypes: defaultEnabledPoiTypes, enabledPoiTags: new Set<string>() });
					},
					poiFilterPresets: [],
					savePoiFilterPreset: (name: string): string | null => {
						const trimmed = name.trim();
						if (!trimmed) return null;
						const id = newId();
						const preset = {
							id,
							name: trimmed,
							enabledPoiTypes: [...get().enabledPoiTypes],
							enabledPoiTags: [...get().enabledPoiTags],
						};
						set({ poiFilterPresets: [...get().poiFilterPresets, preset] });
						return id;
					},
					applyPoiFilterPreset: (id: string): void => {
						const preset = get().poiFilterPresets.find((p) => p.id === id);
						if (!preset) return;
						set({
							enabledPoiTypes: new Set(preset.enabledPoiTypes),
							enabledPoiTags: new Set(preset.enabledPoiTags),
							poiFiltersUserModified: true,
						});
					},
					deletePoiFilterPreset: (id: string): void => {
						set({ poiFilterPresets: get().poiFilterPresets.filter((p) => p.id !== id) });
					},
					renamePoiFilterPreset: (id: string, name: string): void => {
						const trimmed = name.trim();
						if (!trimmed) return;
						set({
							poiFilterPresets: get().poiFilterPresets.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
						});
					},

					stagePlanPresets: [],
					saveStagePlanPreset: (name, inputs): string | null => {
						const trimmed = name.trim();
						if (!trimmed) return null;
						const id = newId();
						set({ stagePlanPresets: [...get().stagePlanPresets, { id, name: trimmed, inputs }] });
						return id;
					},
					deleteStagePlanPreset: (id: string): void => {
						set({ stagePlanPresets: get().stagePlanPresets.filter((p) => p.id !== id) });
					},
					starredPoiCollections: [],
					activeStarredCollectionId: null,
					setActiveStarredCollectionId: (id: string): void => {
						if (!get().starredPoiCollections.some((c) => c.id === id)) return;
						set({ activeStarredCollectionId: id });
					},
					createStarredPoiCollection: (name: string): string | null => {
						const trimmed = name.trim();
						if (!trimmed) return null;
						const id = newId();
						set({
							starredPoiCollections: [...get().starredPoiCollections, { id, name: trimmed, poiIds: [] }],
							activeStarredCollectionId: id,
						});
						return id;
					},
					renameStarredPoiCollection: (id: string, name: string): void => {
						const trimmed = name.trim();
						if (!trimmed) return;
						set({
							starredPoiCollections: get().starredPoiCollections.map((c) =>
								c.id === id ? { ...c, name: trimmed } : c,
							),
						});
					},
					deleteStarredPoiCollection: (id: string): void => {
						const { starredPoiCollections, activeStarredCollectionId } = get();
						const nextCollections = starredPoiCollections.filter((c) => c.id !== id);
						if (nextCollections.length === starredPoiCollections.length) return;
						const nextActiveId =
							activeStarredCollectionId === id ? (nextCollections[0]?.id ?? null) : activeStarredCollectionId;
						set({ starredPoiCollections: nextCollections, activeStarredCollectionId: nextActiveId });
					},
					toggleStarredPoi: (id: string): void => {
						let { starredPoiCollections, activeStarredCollectionId } = get();
						if (!activeStarredCollectionId || !starredPoiCollections.some((c) => c.id === activeStarredCollectionId)) {
							const colId = newId();
							starredPoiCollections = [
								...starredPoiCollections,
								{ id: colId, name: DEFAULT_STARRED_COLLECTION_NAME, poiIds: [] },
							];
							activeStarredCollectionId = colId;
						}
						const activeId = activeStarredCollectionId;
						const nextCollections = starredPoiCollections.map((c) => {
							if (c.id !== activeId) return c;
							const ids = new Set(c.poiIds);
							if (ids.has(id)) ids.delete(id);
							else ids.add(id);
							return { ...c, poiIds: [...ids] };
						});
						set({ starredPoiCollections: nextCollections, activeStarredCollectionId: activeId });
					},
					clearStarredPois: (): void => {
						const activeId = get().activeStarredCollectionId;
						if (!activeId) return;
						set({
							starredPoiCollections: get().starredPoiCollections.map((c) =>
								c.id === activeId ? { ...c, poiIds: [] } : c,
							),
						});
					},
					importStarredPoisFromShare: (poiIds: string[]): void => {
						const colId = newId();
						set({
							starredPoiCollections: [{ id: colId, name: DEFAULT_STARRED_COLLECTION_NAME, poiIds: [...poiIds] }],
							activeStarredCollectionId: colId,
						});
					},
					pendingOpenPoiId: null,
					requestOpenPoi: (id: string): void => {
						set({ pendingOpenPoiId: id });
					},
					clearPendingOpenPoi: (): void => {
						set({ pendingOpenPoiId: null });
					},
					lightboxImages: null,
					lightboxIndex: 0,
					openLightbox: (images, index): void => {
						if (images.length === 0) return;
						const clamped = Math.max(0, Math.min(index, images.length - 1));
						set({ lightboxImages: images, lightboxIndex: clamped });
					},
					closeLightbox: (): void => {
						set({ lightboxImages: null, lightboxIndex: 0 });
					},
					setLightboxIndex: (index): void => {
						const images = get().lightboxImages;
						if (!images || images.length === 0) return;
						const clamped = Math.max(0, Math.min(index, images.length - 1));
						set({ lightboxIndex: clamped });
					},

					seasonalStatusFile: null,
					setSeasonalStatusFile: (file: SeasonalStatusFile | null): void => {
						set({
							seasonalStatusFile: file,
							seasonalStatusEntries: file ? filterActiveEntries(file.entries) : [],
						});
					},
					seasonalStatusEntries: [],
					seasonalStatusLayerEnabled: seasonalStatusLayerEnabledOverride ?? isSeasonalStatusDefaultEnabled(),
					seasonalStatusLayerUserToggled: false,
					setSeasonalStatusLayerEnabled: (enabled: boolean): void => {
						set({
							seasonalStatusLayerEnabled: enabled,
							seasonalStatusLayerUserToggled: true,
						});
					},
					seasonalStatusModalEntry: null,
					setSeasonalStatusModalEntry: (entry: SeasonalStatusEntry | null): void => {
						set({ seasonalStatusModalEntry: entry });
					},
					seasonalStatusHoveredEntryId: null,
					setSeasonalStatusHoveredEntryId: (id: string | null): void => {
						set({ seasonalStatusHoveredEntryId: id });
					},
				};
			},
			{
				name: 'cldt-map-storage',
				storage: createJSONStorage(() => localStorage),
				partialize: (state) => {
					const demoSnapshot = state.demoModeActive ? state.demoPersistSnapshot : null;
					return {
						units: state.units,
						lastKnownFix: state.lastKnownFix,
						sosCard: state.sosCard,
						direction: state.direction,
						showBoundary: state.showBoundary,
						showTileBoundary: state.showTileBoundary,
						showUserMarker: state.showUserMarker,
						showSections: state.showSections,
						gradeTintedTrail: state.gradeTintedTrail,
						surfaceColoured: state.surfaceColoured,
						sacColoured: state.sacColoured,
						showDistanceMarkers: state.showDistanceMarkers,
						poisLayerEnabled: state.poisLayerEnabled,
						poiDisclaimerDismissedAt: state.poiDisclaimerDismissedAt,
						// Set isn't JSON-serialisable; persist as an array and re-hydrate in merge().
						enabledPoiTypes: [...state.enabledPoiTypes],
						enabledPoiTags: [...state.enabledPoiTags],
						poiFiltersUserModified: state.poiFiltersUserModified,
						poiFilterPresets: state.poiFilterPresets,
						stagePlanPresets: state.stagePlanPresets,
						starredPoiCollections: state.starredPoiCollections,
						activeStarredCollectionId: state.activeStarredCollectionId,
						distancePrecision: state.distancePrecision,
						darkMode: state.darkMode,
						batterySaverMode: state.batterySaverMode,
						compassEnabled: state.compassEnabled,
						keepScreenOn: state.keepScreenOn,
						offRouteAlertEnabled: state.offRouteAlertEnabled,
						largeTouchTargets: state.largeTouchTargets,
						uiTextScale: state.uiTextScale,
						baseMapProvider: state.baseMapProvider,
						autoSync: state.autoSync,
						predictivePrecache: state.predictivePrecache,
						offlineHighDetailAheadEnabled: state.offlineHighDetailAheadEnabled,
						walkingPaceKmh: state.walkingPaceKmh,
						paceFactor: state.paceFactor,
						onboardingSeen: state.onboardingSeen,
						packBaseWeightKg: state.packBaseWeightKg,
						waterConsumptionLph: state.waterConsumptionLph,
						foodConsumptionKgPerDay: state.foodConsumptionKgPerDay,
						packEtaAdjust: state.packEtaAdjust,
						packGearList: state.packGearList,
						pushAlertsEnabled: state.pushAlertsEnabled,
						waymarkedTrailsOverlay: state.waymarkedTrailsOverlay,
						shareShortLinks: state.shareShortLinks,
						includeRemotePois: state.includeRemotePois,
						userWaypoints: demoSnapshot ? demoSnapshot.userWaypoints : state.userWaypoints,
						lastWaypointCategory: state.lastWaypointCategory,
						hiddenWaypointCategories: [...state.hiddenWaypointCategories],
						journalEntries: demoSnapshot ? demoSnapshot.journalEntries : state.journalEntries,
						poiWaterLog: state.poiWaterLog,
						poiNotes: state.poiNotes,
						navTarget: state.navTarget,
						gradeAdjustedEta: state.gradeAdjustedEta,
						sunsetProjection: state.sunsetProjection,
						stagePlan: state.stagePlan,
						severeWeatherLayer: state.severeWeatherLayer,
						mineAreasEnabled: state.mineAreasEnabled,
						showUpNext: state.showUpNext,
						upNextShowFood: state.upNextShowFood,
						upNextShowAtm: state.upNextShowAtm,
						upNextShowViewpoint: state.upNextShowViewpoint,
						upNextShowPharmacy: state.upNextShowPharmacy,
						upNextMoreExpanded: state.upNextMoreExpanded,
						aheadHorizonKm: state.aheadHorizonKm,
						completedIntervals: demoSnapshot ? demoSnapshot.completedIntervals : state.completedIntervals,
						progressTrackIds: state.progressTrackIds,
						completionAutoTrack: state.completionAutoTrack,
						showCompletionOverlay: state.showCompletionOverlay,
						progressPanelWaypointsOpen: state.progressPanelWaypointsOpen,
						progressPanelJournalOpen: state.progressPanelJournalOpen,
						settingsPanelOverlaysOpen: state.settingsPanelOverlaysOpen,
						settingsPanelPackOpen: state.settingsPanelPackOpen,
						settingsPanelNotificationsOpen: state.settingsPanelNotificationsOpen,
						settingsPanelOfflineOpen: state.settingsPanelOfflineOpen,
						settingsPanelImportsOpen: state.settingsPanelImportsOpen,
						helpPanelBasicsOpen: state.helpPanelBasicsOpen,
						helpPanelChartOpen: state.helpPanelChartOpen,
						helpPanelGesturesOpen: state.helpPanelGesturesOpen,
						helpPanelPlanningOpen: state.helpPanelPlanningOpen,
						helpPanelOfflineOpen: state.helpPanelOfflineOpen,
						helpPanelDemoOpen: state.helpPanelDemoOpen,
						poiListFiltersOpen: state.poiListFiltersOpen,
						poiListSortOpen: state.poiListSortOpen,
						poiListTagsOpen: state.poiListTagsOpen,
						poiListStarsOpen: state.poiListStarsOpen,
						poiListExportOpen: state.poiListExportOpen,
						stagePlannerSetupOpen: state.stagePlannerSetupOpen,
						stagePlannerStagesOpen: state.stagePlannerStagesOpen,
						stagePlannerExportOpen: state.stagePlannerExportOpen,
						seasonalStatusLayerEnabled: state.seasonalStatusLayerEnabled,
						seasonalStatusLayerUserToggled: state.seasonalStatusLayerUserToggled,
					};
				},
				merge: (persistedState, currentState) => {
					const merged = {
						...currentState,
						...(persistedState as Partial<MapStoreState>),
					};
					// Reject a corrupt, out-of-range, or stale persisted last-known fix so the
					// emergency panel never renders garbage coordinates or a months-old position.
					const rawLastKnownFix = (persistedState as { lastKnownFix?: unknown })?.lastKnownFix;
					merged.lastKnownFix = isValidLastKnownFix(rawLastKnownFix) ? rawLastKnownFix : null;
					// Sanitize the rehydrated SOS card to known string fields only.
					merged.sosCard = sanitizeSosCard((persistedState as { sosCard?: unknown })?.sosCard);
					// Drop any malformed personal water-log entries so a corrupt
					// localStorage value can never render garbage in a popup.
					merged.poiWaterLog = sanitizeWaterLog((persistedState as { poiWaterLog?: unknown })?.poiWaterLog);
					// Drop malformed/oversized personal POI notes on rehydrate.
					merged.poiNotes = sanitizePoiNotes((persistedState as { poiNotes?: unknown })?.poiNotes);
					// Reject a corrupt persisted nav target so the HUD never renders garbage coords.
					merged.navTarget = sanitizeNavTarget((persistedState as { navTarget?: unknown })?.navTarget);
					// Clamp a persisted pace factor back into range (guards a hand-edited
					// or out-of-range value from skewing every ETA).
					merged.paceFactor = clampPaceFactor((persistedState as { paceFactor?: unknown })?.paceFactor as number);
					// If the user has never explicitly toggled the seasonal layer,
					// recompute it on every hydration. Explicit env override wins
					// unconditionally; otherwise fall back to the winter-window
					// auto-default (Nov 1 - May 31) so the default tracks the
					// season across sessions.
					if (!merged.seasonalStatusLayerUserToggled) {
						merged.seasonalStatusLayerEnabled = seasonalStatusLayerEnabledOverride ?? isSeasonalStatusDefaultEnabled();
					}
					// enabledPoiTypes/Tags and legacy starredPoiIds were persisted as arrays
					// (Set is not JSON-serialisable). Re-hydrate as Sets so the
					// runtime API stays consistent across first paint and
					// subsequent renders.
					const rehydrateSet = (raw: unknown): Set<string> | null =>
						Array.isArray(raw) ? new Set(raw.filter((s): s is string => typeof s === 'string')) : null;
					const rehydratedTypes = rehydrateSet((persistedState as { enabledPoiTypes?: unknown })?.enabledPoiTypes);
					if (rehydratedTypes) merged.enabledPoiTypes = rehydratedTypes;
					const rehydratedTags = rehydrateSet((persistedState as { enabledPoiTags?: unknown })?.enabledPoiTags);
					if (rehydratedTags) merged.enabledPoiTags = rehydratedTags;

					const rawPresets = (persistedState as { poiFilterPresets?: unknown })?.poiFilterPresets;
					if (Array.isArray(rawPresets)) {
						merged.poiFilterPresets = rawPresets.filter(
							(p): p is NonNullable<MapStoreState['poiFilterPresets']>[number] =>
								!!p &&
								typeof p === 'object' &&
								typeof (p as { id?: unknown }).id === 'string' &&
								typeof (p as { name?: unknown }).name === 'string' &&
								Array.isArray((p as { enabledPoiTypes?: unknown }).enabledPoiTypes) &&
								Array.isArray((p as { enabledPoiTags?: unknown }).enabledPoiTags),
						);
					}

					const rawStagePresets = (persistedState as { stagePlanPresets?: unknown })?.stagePlanPresets;
					if (Array.isArray(rawStagePresets)) {
						merged.stagePlanPresets = rawStagePresets.filter(
							(p): p is NonNullable<MapStoreState['stagePlanPresets']>[number] =>
								!!p &&
								typeof p === 'object' &&
								typeof (p as { id?: unknown }).id === 'string' &&
								typeof (p as { name?: unknown }).name === 'string' &&
								!!(p as { inputs?: unknown }).inputs &&
								typeof (p as { inputs?: unknown }).inputs === 'object',
						);
					}

					const legacyStarred = rehydrateSet((persistedState as { starredPoiIds?: unknown })?.starredPoiIds);
					const rawCollections = (persistedState as { starredPoiCollections?: unknown })?.starredPoiCollections;
					if (Array.isArray(rawCollections) && rawCollections.length > 0) {
						merged.starredPoiCollections = rawCollections
							.filter(
								(c): c is NonNullable<MapStoreState['starredPoiCollections']>[number] =>
									!!c &&
									typeof c === 'object' &&
									typeof (c as { id?: unknown }).id === 'string' &&
									typeof (c as { name?: unknown }).name === 'string' &&
									Array.isArray((c as { poiIds?: unknown }).poiIds),
							)
							.map((c) => ({
								id: c.id,
								name: c.name,
								poiIds: c.poiIds.filter((id): id is string => typeof id === 'string'),
							}));
						const activeId = (persistedState as { activeStarredCollectionId?: unknown })?.activeStarredCollectionId;
						merged.activeStarredCollectionId =
							typeof activeId === 'string' && merged.starredPoiCollections.some((c) => c.id === activeId)
								? activeId
								: (merged.starredPoiCollections[0]?.id ?? null);
					} else if (legacyStarred && legacyStarred.size > 0) {
						const colId = newId();
						merged.starredPoiCollections = [
							{ id: colId, name: DEFAULT_STARRED_COLLECTION_NAME, poiIds: [...legacyStarred] },
						];
						merged.activeStarredCollectionId = colId;
					} else {
						merged.starredPoiCollections = merged.starredPoiCollections ?? [];
						merged.activeStarredCollectionId = merged.activeStarredCollectionId ?? null;
					}

					const rehydratedHiddenWp = rehydrateSet(
						(persistedState as { hiddenWaypointCategories?: unknown })?.hiddenWaypointCategories,
					);
					if (rehydratedHiddenWp) {
						merged.hiddenWaypointCategories = rehydratedHiddenWp as Set<WaypointCategoryId>;
					}
					if (typeof (persistedState as { lastWaypointCategory?: unknown })?.lastWaypointCategory === 'string') {
						merged.lastWaypointCategory = normalizeWaypointCategory(
							(persistedState as { lastWaypointCategory: string }).lastWaypointCategory,
						);
					}
					if (typeof merged.aheadHorizonKm === 'string') merged.aheadHorizonKm = Number(merged.aheadHorizonKm);
					if (!isAheadHorizonKm(merged.aheadHorizonKm)) merged.aheadHorizonKm = 50;
					if (!isUiTextScale(merged.uiTextScale)) merged.uiTextScale = 'default';
					return merged;
				},
			},
		),
	);
}
