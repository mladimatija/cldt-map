import type { StateCreator } from 'zustand';
import { LocationService } from '../services/location-service';
import { toLocationError } from '../utils';
import type { StoreState, LocationSlice } from './types';
import { L } from './leaflet';

export const createLocationSlice: StateCreator<StoreState, [], [], LocationSlice> = (set, get) => ({
	userLocation: null,
	isLocating: false,
	userLocationInitialized: false,
	initialLocationSet: false,
	permissionStatus: null,
	showPermissionNotification: false,
	locationError: null,
	showUserMarker: true,

	setUserLocation: (location) => set({ userLocation: location }),
	setIsLocating: (isLocating) => set({ isLocating }),
	setUserLocationInitialized: (initialized) => set({ userLocationInitialized: initialized }),
	setInitialLocationSet: (value) => set({ initialLocationSet: value }),
	setPermissionStatus: (status) => set({ permissionStatus: status }),
	setShowPermissionNotification: (show) => set({ showPermissionNotification: show }),
	setLocationError: (error) => set({ locationError: error }),
	setShowUserMarker: (show) => set({ showUserMarker: show }),

	handleLocationUpdate: (location): void => {
		const state = get();

		if (!state.userLocationInitialized) {
			set({ userLocationInitialized: true });
		}
		if (state.initialLocationSet) {
			return;
		}

		const locationObj = {
			lat: location.lat,
			lng: location.lng,
		};

		set({
			userLocation: locationObj,
			initialLocationSet: true,
			isLocating: false,
		});

		const event = new CustomEvent('userLocationUpdate', {
			detail: { location },
		});
		window.dispatchEvent(event);

		setTimeout(() => {
			if (get().calculateClosestPoint) {
				get().calculateClosestPoint();
			}
		}, 500);
	},

	togglePermissionNotification: (visible): void => {
		set({ showPermissionNotification: visible });
	},

	getCurrentLocation: async (): Promise<void> => {
		set({ isLocating: true, locationError: null });

		try {
			const locationService = LocationService.getInstance();
			const result = await locationService.getCurrentLocation();

			if (result.lat && result.lng) {
				if (typeof L === 'undefined') {
					return;
				}
				const location = new L.LatLng(result.lat, result.lng);
				get().handleLocationUpdate(location);

				if (typeof result.accuracy === 'number') {
					const currentLocation = get().userLocation;
					if (currentLocation) {
						set({
							userLocation: {
								...currentLocation,
								accuracy: result.accuracy,
							},
						});
					}
				}

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
		} catch (error) {
			set({
				locationError: toLocationError(error, 'Unknown error getting location'),
				isLocating: false,
			});
		} finally {
			set({ isLocating: false });
		}
	},

	initLocationService: (): void => {
		const locationService = LocationService.getInstance();

		locationService.setStoreUpdater({
			setPermissionStatus: (status) => set({ permissionStatus: status }),
			setUserLocation: (location) => set({ userLocation: location }),
			setIsLocating: (isLocating) => set({ isLocating }),
			setLocationError: (error) => set({ locationError: error }),
		});

		locationService
			.checkPermission()
			.then((result) => {
				const permissionState = result.state;
				set({ permissionStatus: permissionState });
			})
			.catch((error) => {
				console.error('Error initializing location service:', error);
				set({ permissionStatus: 'denied' });
			});
	},

	requestLocationPermission: async (): Promise<void> => {
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
});
