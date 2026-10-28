/**
 * Browser geolocation wrapper: getCurrentLocation, watchPosition, permission checks, and optional store sync via setStoreUpdater.
 * Singleton; used by the map store for one-off requests and the live watch (startLocationTracking).
 */
import { LocationError } from '@/lib/errors';
import {
	addGeolocationPermissionListener,
	type GeolocationPermissionState,
	getGeolocationPermissionState,
} from './geolocation-permission';
import { type LocationOptions, toPositionOptions } from './location-options';
import type { LastKnownFix } from '../store/types';

type PermissionState = GeolocationPermissionState;

export type { LocationOptions };

/**
 * Result from a location request
 */
export interface LocationResult {
	lat: number;
	lng: number;
	accuracy?: number | null;
	timestamp?: number | null;
	permissionStatus?: PermissionState;
	error?: {
		code: number;
		message: string;
	} | null;
}

/**
 * Function type for updating store state
 */
type StoreUpdater = {
	setPermissionStatus?: (status: PermissionState) => void;
	setUserLocation?: (location: { lat: number; lng: number; accuracy?: number } | null) => void;
	setIsLocating?: (isLocating: boolean) => void;
	setLocationError?: (error: { code: number; message: string } | null) => void;
	setLastKnownFix?: (fix: LastKnownFix) => void;
};

/**
 * A service to handle geolocation operations
 * Uses the Singleton pattern to ensure only one instance exists
 */
export class LocationService {
	private static instance: LocationService;
	private watchId: number | null = null;
	private permissionChangeCallbacks: Array<(state: PermissionState) => void> = [];
	private permissionResult: { state: PermissionState } | null = null;
	private storeUpdater: StoreUpdater = {};
	private permissionListenerUnsubscribe: (() => void) | null = null;

	private constructor() {}

	/**
	 * Get the singleton instance
	 */
	public static getInstance(): LocationService {
		if (!LocationService.instance) {
			LocationService.instance = new LocationService();
		}
		return LocationService.instance;
	}

	/**
	 * Set the store updater functions
	 * @param updater Object containing store setter functions
	 */
	public setStoreUpdater(updater: StoreUpdater): void {
		this.storeUpdater = updater;
	}

	/** Publish a successful fix to the store. One-off requests always publish and
	 *  save the last-known fix; the live watch decides per fix (see the map
	 *  store's startLocationTracking) and passes `saveLastKnownFix: false` for
	 *  the fixes it does not persist. */
	public applyFixToStore(
		location: {
			lat: number;
			lng: number;
			accuracy?: number | null;
			timestamp?: number;
		},
		{ saveLastKnownFix = true }: { saveLastKnownFix?: boolean } = {},
	): void {
		if (this.storeUpdater.setUserLocation) {
			this.storeUpdater.setUserLocation({
				lat: location.lat,
				lng: location.lng,
				accuracy: location.accuracy ?? undefined,
			});
		}
		// Persist the fix (with its GPS timestamp) so the emergency panel can show a
		// real last-known position with its age when live GPS later drops.
		if (saveLastKnownFix && typeof location.timestamp === 'number' && this.storeUpdater.setLastKnownFix) {
			this.storeUpdater.setLastKnownFix({
				lat: location.lat,
				lng: location.lng,
				accuracy: location.accuracy ?? undefined,
				timestamp: location.timestamp,
			});
		}
		// A fix proves the permission.
		this.permissionResult = { state: 'granted' };
		if (this.storeUpdater.setPermissionStatus) {
			this.storeUpdater.setPermissionStatus('granted');
		}
		if (this.storeUpdater.setLocationError) {
			this.storeUpdater.setLocationError(null);
		}
	}

	/**
	 * Check if geolocation is available in this browser
	 */
	public isGeolocationAvailable(): boolean {
		return 'geolocation' in navigator;
	}

	/**
	 * Check the current permission state for geolocation
	 * Returns a promise that resolves to the permission status
	 * If permissionOnly is true, it will only check the permission without updating the store
	 */
	public async checkPermission(updateStore = true): Promise<{ state: PermissionState }> {
		const state = await getGeolocationPermissionState();
		this.permissionResult = { state };

		if (updateStore && !this.permissionListenerUnsubscribe) {
			this.permissionListenerUnsubscribe = addGeolocationPermissionListener((newState) => {
				this.permissionResult = { state: newState };
				if (this.storeUpdater.setPermissionStatus) {
					this.storeUpdater.setPermissionStatus(newState);
				}
				// No fetch here: a newly granted permission starts the live watch
				// (useLocationTracking), so startup requests location only once.
				this.permissionChangeCallbacks.forEach((cb) => cb(newState));
			});
		}

		if (updateStore && this.storeUpdater.setPermissionStatus) {
			this.storeUpdater.setPermissionStatus(state);
		}

		return { state };
	}

	/**
	 * Request geolocation permission explicitly, triggering the browser prompt
	 * This is useful for initial app load to get permission status
	 */
	public async requestPermission(forcePrompt = true): Promise<{ state: PermissionState }> {
		// First, check current permission without triggering a prompt
		const currentPermission = await this.checkPermission(true);

		// If permission is already denied or granted, return that state
		if (currentPermission.state !== 'prompt') {
			return currentPermission;
		}

		// If we're supposed to force a prompt, request location to trigger the browser prompt
		if (forcePrompt) {
			// Set a locating state if available
			if (this.storeUpdater.setIsLocating) {
				this.storeUpdater.setIsLocating(true);
			}

			try {
				// This will trigger the browser permission prompt
				await this.getCurrentLocation();

				// Re-check permission after request
				return await this.checkPermission(true);
			} catch (error) {
				console.error('Error requesting permission:', error);
				return { state: 'prompt' };
			} finally {
				// Reset locating state
				if (this.storeUpdater.setIsLocating) {
					this.storeUpdater.setIsLocating(false);
				}
			}
		}

		return currentPermission;
	}

	/**
	 * Register a callback to be notified of permission changes
	 * @param callback Function to call when permission state changes
	 * @returns Function to unregister the callback
	 */
	public onPermissionChange(callback: (state: PermissionState) => void): () => void {
		this.permissionChangeCallbacks.push(callback);

		// Return function to remove this callback
		return () => {
			const index = this.permissionChangeCallbacks.indexOf(callback);
			if (index !== -1) {
				this.permissionChangeCallbacks.splice(index, 1);
			}
		};
	}

	/**
	 * Get current position as a promise
	 * @param options Options for the geolocation request
	 * @returns Promise resolving to a location result
	 */
	public async getCurrentLocation(options: LocationOptions = {}): Promise<LocationResult> {
		if (!this.isGeolocationAvailable()) {
			const error = {
				code: 0,
				message: 'Geolocation is not supported by this browser.',
			};

			// Update the store error state if available
			if (this.storeUpdater.setLocationError) {
				this.storeUpdater.setLocationError(error);
			}

			return {
				lat: 0,
				lng: 0,
				error,
			};
		}

		try {
			// The permission listener keeps the cached state current, so a request
			// queries the Permissions API only the first time and after a denial
			// (browsers without change events would otherwise never recover).
			const cached = this.permissionResult;
			const permissionStatus = cached && cached.state !== 'denied' ? cached : await this.checkPermission(true);

			if (permissionStatus.state === 'denied') {
				const error = {
					code: 1,
					message: 'Location permission is denied',
				};

				// Update the store error state if available
				if (this.storeUpdater.setLocationError) {
					this.storeUpdater.setLocationError(error);
				}

				return {
					lat: 0,
					lng: 0,
					permissionStatus: 'denied',
					error,
				};
			}

			const defaultOptions = toPositionOptions(options);

			return new Promise<LocationResult>((resolve) => {
				navigator.geolocation.getCurrentPosition(
					(position) => {
						const result = {
							lat: position.coords.latitude,
							lng: position.coords.longitude,
							accuracy: position.coords.accuracy,
							timestamp: position.timestamp,
							permissionStatus: 'granted' as PermissionState,
						};
						this.applyFixToStore({
							lat: result.lat,
							lng: result.lng,
							accuracy: result.accuracy,
							timestamp: result.timestamp,
						});
						resolve(result);
					},
					(error) => {
						const errorResult = {
							code: error.code,
							message: error.message || 'Unknown error getting location',
						};
						// Only a denial changes the permission; a timeout or an unavailable
						// position keeps it (and with it the user marker and wake lock).
						const denied = error.code === error.PERMISSION_DENIED;
						if (denied) this.markPermissionDenied();

						if (this.storeUpdater.setLocationError) {
							this.storeUpdater.setLocationError(errorResult);
						}

						resolve({
							lat: 0,
							lng: 0,
							...(denied && { permissionStatus: 'denied' as PermissionState }),
							error: errorResult,
						});
					},
					defaultOptions,
				);
			});
		} catch (error) {
			throw new LocationError('Failed to get current location', error);
		}
	}

	/**
	 * Start watching position with callbacks for updates and errors. Replaces
	 * any watch already running. Fixes go to `onSuccess` only; the caller
	 * decides which to publish (applyFixToStore). Errors update the store's
	 * location error, and a denial also the permission.
	 * @param onSuccess Callback for successful location updates
	 * @param onError Callback for errors
	 * @param options Location options
	 * @returns Function to stop watching
	 */
	public watchLocation(
		onSuccess: (location: LocationResult) => void,
		onError: (error: LocationError) => void,
		options: LocationOptions = {},
	): () => void {
		if (!this.isGeolocationAvailable()) {
			onError(new LocationError('Geolocation is not supported by your browser'));
			return () => {};
		}

		const defaultOptions = toPositionOptions(options);
		// One watch at a time: starting again replaces the previous watch.
		this.stopWatchingLocation();

		try {
			this.watchId = navigator.geolocation.watchPosition(
				(position) => {
					onSuccess({
						lat: position.coords.latitude,
						lng: position.coords.longitude,
						accuracy: position.coords.accuracy,
						timestamp: position.timestamp,
					});
				},
				(error) => {
					let message;
					let permissionStatus: PermissionState | undefined;

					switch (error.code) {
						case error.PERMISSION_DENIED:
							message = 'Location permission denied';
							permissionStatus = 'denied';
							break;
						case error.POSITION_UNAVAILABLE:
							message = 'Location information unavailable';
							break;
						case error.TIMEOUT:
							message = 'Location request timed out';
							break;
						default:
							message = 'An unknown error occurred';
					}

					// Only a denial changes the permission; the watch keeps running
					// through timeouts and unavailable positions.
					if (permissionStatus === 'denied') this.markPermissionDenied();

					if (this.storeUpdater.setLocationError) {
						this.storeUpdater.setLocationError({
							code: error.code,
							message: message,
						});
					}

					onError(
						new LocationError(message, {
							originalError: error,
							permissionStatus,
						}),
					);
				},
				defaultOptions,
			);
		} catch (error) {
			onError(new LocationError('Error setting up location watch', error));
		}

		// Return function to stop watching
		return this.stopWatchingLocation.bind(this);
	}

	/** Record a denial from a failed request, so the cached state (used instead
	 *  of re-querying the Permissions API) and the store agree. */
	private markPermissionDenied(): void {
		this.permissionResult = { state: 'denied' };
		if (this.storeUpdater.setPermissionStatus) {
			this.storeUpdater.setPermissionStatus('denied');
		}
	}

	/**
	 * Stop watching position. The single stop path for the live watch.
	 */
	public stopWatchingLocation(): void {
		if (this.watchId !== null) {
			navigator.geolocation.clearWatch(this.watchId);
			this.watchId = null;
		}
	}
}
