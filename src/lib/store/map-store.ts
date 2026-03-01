import type * as GeoJSON from 'geojson';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { config } from '../config';
import { getRandomLocationInBoundary, toLocationError } from '../utils';
import { LocationService } from '../services/location-service';
import type { MapStoreState, StoreState, TrailDirection, UnitSystem } from './types';

/**
 * Creates the persisted map store. Receives getMainStore so it does not import the main store at module init (avoids circular deps).
 */
export function createMapStore(getMainStore: () => StoreState): UseBoundStore<StoreApi<MapStoreState>> {
	return create<MapStoreState>()(
		persist(
			(set, get) => ({
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

				units: config.units,
				setUnits: (units: UnitSystem) => set({ units }),
				distancePrecision: config.distancePrecision,
				setDistancePrecision: (precision: number) => set({ distancePrecision: precision }),

				direction: config.direction,
				setDirection: (direction: TrailDirection) => set({ direction }),

				showBoundary: config.showBoundary,
				setShowBoundary: (show: boolean) => set({ showBoundary: show }),
				showTileBoundary: config.showTileBoundary,
				setShowTileBoundary: (show: boolean) => set({ showTileBoundary: show }),

				isRulerEnabled: config.rulerEnabled,
				setRulerEnabled: (enabled: boolean) => set({ isRulerEnabled: enabled }),

				userLocation: null,
				isLocating: false,
				permissionStatus: null,
				locationError: null,
				showUserMarker: config.showUserMarker,
				setUserLocation: (location: { lat: number; lng: number; accuracy?: number } | null) =>
					set({ userLocation: location }),
				setIsLocating: (isLocating: boolean) => set({ isLocating }),
				setPermissionStatus: (status: 'granted' | 'denied' | 'prompt' | null) => set({ permissionStatus: status }),
				setLocationError: (error: { code: number; message: string } | null) => set({ locationError: error }),
				setShowUserMarker: (show: boolean) => set({ showUserMarker: show }),
				fakeUserLocationEnabled: false,
				setFakeUserLocationEnabled: (enabled: boolean) => {
					set({ fakeUserLocationEnabled: enabled });
					if (enabled) {
						const loc = getRandomLocationInBoundary();
						set({
							userLocation: { lat: loc.lat, lng: loc.lng, accuracy: 50 },
							permissionStatus: 'granted' as const,
						});
					} else {
						set({ userLocation: null });
					}
				},
				setFakeUserLocation: () => {
					const loc = getRandomLocationInBoundary();
					set({
						userLocation: { lat: loc.lat, lng: loc.lng, accuracy: 50 },
						permissionStatus: 'granted' as const,
					});
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
					set({
						fakeUserLocationEnabled: true,
						userLocation: { lat, lng, accuracy: 50 },
						permissionStatus: 'granted' as const,
					});
				},

				darkMode: config.darkMode,
				setDarkMode: (enabled: boolean) => set({ darkMode: enabled }),
				batterySaverMode: config.batterySaverMode,
				setBatterySaverMode: (enabled: boolean) => set({ batterySaverMode: enabled }),
				largeTouchTargets: config.largeTouchTargets,
				setLargeTouchTargets: (enabled: boolean) => set({ largeTouchTargets: enabled }),
				showSections: config.showSections,
				setShowSections: (show: boolean) => set({ showSections: show }),
				baseMapProvider: config.baseMapProvider,
				setBaseMapProvider: (provider: string) => set({ baseMapProvider: provider }),

				processTrailData: (
					points: unknown[],
					elevationPoints: { lat: number; lng: number; elevation: number }[],
					startPoint: unknown,
					endPoint: unknown,
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
							setTimeout(() => {
								mainStore.calculateClosestPoint?.();
							}, 100);
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
							set({ permissionStatus: result.state });
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
						set({ permissionStatus: result.state });

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
			}),
			{
				name: 'map-storage',
				storage: createJSONStorage(() => localStorage),
				partialize: (state) => ({
					units: state.units,
					direction: state.direction,
					showBoundary: state.showBoundary,
					showTileBoundary: state.showTileBoundary,
					showUserMarker: state.showUserMarker,
					showSections: state.showSections,
					distancePrecision: state.distancePrecision,
					darkMode: state.darkMode,
					batterySaverMode: state.batterySaverMode,
					largeTouchTargets: state.largeTouchTargets,
					baseMapProvider: state.baseMapProvider,
				}),
			},
		),
	);
}
