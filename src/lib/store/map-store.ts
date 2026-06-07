import type * as GeoJSON from 'geojson';
import type { LatLng } from 'leaflet';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
	config,
	defaultEnabledPoiTypes,
	seasonalStatusLayerEnabledOverride,
	TRAIL_OFF_TRAIL_THRESHOLD_M,
} from '../config';
import { getRandomLocationInBoundary, toLocationError } from '../utils';
import { LocationService } from '../services/location-service';
import type { ImportedTrack, MapStoreState, StagePlan, StoreState, TrailDirection, UnitSystem } from './types';
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
	runPredictivePrecache,
	abortPredictivePrecache,
	resetPredictivePrecacheBuckets,
	PRECACHE_ZOOM_MIN,
	PRECACHE_ZOOM_MAX,
	type TileCacheMeta,
	type NavigatorWithConnection,
	type NavigatorWithBattery,
	type PredictivePrecacheSlicePoint,
} from '../tile-cache';
import { findNearestPointIndex, RulerRange } from '@/lib/distance-utils';
import { loadImportedTracks, removeImportedTrack } from '../imported-tracks';
import { loadPois } from '@/lib/pois';
import { prefetchPoiAssets, prefetchPoisAlongSlice } from '@/lib/poi-prefetch';
import {
	filterActiveEntries,
	isSeasonalStatusDefaultEnabled,
	type SeasonalStatusEntry,
	type SeasonalStatusFile,
} from '../seasonal-status';

/** Module-level abort controller for tile downloads - one download at a time. */
let tilePrecacheAbortController: AbortController | null = null;

/** Last time a GPS-source predictive pre-cache check was evaluated. Module-scoped so the debounce survives selector subscriptions. */
let lastPredictiveCheckAt = 0;
const PREDICTIVE_GPS_DEBOUNCE_MS = 30_000;

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
				 *  so panels can refresh their counts. Failures are silent: the
				 *  tile precache already succeeded by the time this runs, and the
				 *  POI prefetch is best-effort. Scoped to the store factory so all
				 *  cache orchestration lives inside `useMapStore` actions. */
				async function prefetchPoiAssetsAfterDownload(): Promise<void> {
					const file = await loadPois();
					if (!file?.pois?.length) return;
					try {
						const signal =
							typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(120_000) : new AbortController().signal;
						await prefetchPoiAssets(file.pois, signal);
					} catch {
						// best-effort
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
					largeTouchTargets: config.largeTouchTargets,
					setLargeTouchTargets: (enabled: boolean) => set({ largeTouchTargets: enabled }),
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
					tileCacheMeta: null,
					autoSync: config.autoSync,
					predictivePrecache: config.predictivePrecache,
					poiPrefetchVersion: 0,

					startTileDownload: async (points, providerName) => {
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
						const urls = generateTrailTileUrls(points, urlTemplate, PRECACHE_ZOOM_MIN, PRECACHE_ZOOM_MAX);
						const providerKey = getProviderCacheKey(providerName);
						tilePrecacheAbortController?.abort();
						const controller = new AbortController();
						tilePrecacheAbortController = controller;
						set({ tileCacheDownloading: true, tileCacheDone: 0, tileCacheTotal: urls.length, tileCacheError: null });
						const result = await precacheTiles(
							urls,
							(done, total) => set({ tileCacheDone: done, tileCacheTotal: total }),
							controller.signal,
						);
						tilePrecacheAbortController = null;
						if (!result.cancelled) {
							const meta: TileCacheMeta = {
								cachedAt: Date.now(),
								tileCount: result.done,
								zoomMin: PRECACHE_ZOOM_MIN,
								zoomMax: PRECACHE_ZOOM_MAX,
								providerKey,
							};
							await saveTileCacheMeta(providerKey, meta);
							set({ tileCacheMeta: meta, tileCacheDownloading: false });
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
							set({ showStaleCacheNotification: isCacheStale(meta) });
						} catch {
							// Storage unavailable or corrupted - leave flag false
							set({ showStaleCacheNotification: false });
						}
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
						set((state) => ({ importedTracks: state.importedTracks.filter((t) => t.id !== id) }));
					},

					setImportedTracks: (tracks: ImportedTrack[]): void => {
						set({ importedTracks: tracks });
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
						set({ enabledPoiTypes: types });
					},
					togglePoiType: (type: string): void => {
						const current = get().enabledPoiTypes;
						const next = new Set(current);
						if (next.has(type)) next.delete(type);
						else next.add(type);
						set({ enabledPoiTypes: next });
					},
					// Tags default to "no filter" (empty set). User picks chips in the
					// list panel to narrow the visible POIs by tag intersection.
					enabledPoiTags: new Set<string>(),
					setEnabledPoiTags: (tags): void => {
						set({ enabledPoiTags: tags });
					},
					togglePoiTag: (tag: string): void => {
						const current = get().enabledPoiTags;
						const next = new Set(current);
						if (next.has(tag)) next.delete(tag);
						else next.add(tag);
						set({ enabledPoiTags: next });
					},
					clearPoiTags: (): void => {
						set({ enabledPoiTags: new Set<string>() });
					},
					starredPoiIds: new Set<string>(),
					toggleStarredPoi: (id: string): void => {
						const next = new Set(get().starredPoiIds);
						if (next.has(id)) next.delete(id);
						else next.add(id);
						set({ starredPoiIds: next });
					},
					clearStarredPois: (): void => {
						set({ starredPoiIds: new Set<string>() });
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
				partialize: (state) => ({
					units: state.units,
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
					starredPoiIds: [...state.starredPoiIds],
					distancePrecision: state.distancePrecision,
					darkMode: state.darkMode,
					batterySaverMode: state.batterySaverMode,
					largeTouchTargets: state.largeTouchTargets,
					baseMapProvider: state.baseMapProvider,
					autoSync: state.autoSync,
					predictivePrecache: state.predictivePrecache,
					walkingPaceKmh: state.walkingPaceKmh,
					gradeAdjustedEta: state.gradeAdjustedEta,
					sunsetProjection: state.sunsetProjection,
					stagePlan: state.stagePlan,
					severeWeatherLayer: state.severeWeatherLayer,
					seasonalStatusLayerEnabled: state.seasonalStatusLayerEnabled,
					seasonalStatusLayerUserToggled: state.seasonalStatusLayerUserToggled,
				}),
				merge: (persistedState, currentState) => {
					const merged = {
						...currentState,
						...(persistedState as Partial<MapStoreState>),
					};
					// If the user has never explicitly toggled the seasonal layer,
					// recompute it on every hydration. Explicit env override wins
					// unconditionally; otherwise fall back to the winter-window
					// auto-default (Nov 1 - May 31) so the default tracks the
					// season across sessions.
					if (!merged.seasonalStatusLayerUserToggled) {
						merged.seasonalStatusLayerEnabled = seasonalStatusLayerEnabledOverride ?? isSeasonalStatusDefaultEnabled();
					}
					// enabledPoiTypes/Tags/starredPoiIds were persisted as arrays
					// (Set is not JSON-serialisable). Re-hydrate as Sets so the
					// runtime API stays consistent across first paint and
					// subsequent renders.
					const rehydrateSet = (raw: unknown): Set<string> | null =>
						Array.isArray(raw) ? new Set(raw.filter((s): s is string => typeof s === 'string')) : null;
					const rehydratedTypes = rehydrateSet((persistedState as { enabledPoiTypes?: unknown })?.enabledPoiTypes);
					if (rehydratedTypes) merged.enabledPoiTypes = rehydratedTypes;
					const rehydratedTags = rehydrateSet((persistedState as { enabledPoiTags?: unknown })?.enabledPoiTags);
					if (rehydratedTags) merged.enabledPoiTags = rehydratedTags;
					const rehydratedStarred = rehydrateSet((persistedState as { starredPoiIds?: unknown })?.starredPoiIds);
					if (rehydratedStarred) merged.starredPoiIds = rehydratedStarred;
					return merged;
				},
			},
		),
	);
}
