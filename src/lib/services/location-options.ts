/** Options for geolocation requests (getCurrentPosition / watchPosition). */
export interface LocationOptions {
	enableHighAccuracy?: boolean;
	timeout?: number;
	maximumAge?: number;
}

/** Default values for location requests. */
const DEFAULT_LOCATION_OPTIONS: Required<LocationOptions> = {
	enableHighAccuracy: true,
	timeout: 10000,
	maximumAge: 0,
};

export function toPositionOptions(options: Partial<LocationOptions> = {}): PositionOptions {
	return {
		enableHighAccuracy: options.enableHighAccuracy ?? DEFAULT_LOCATION_OPTIONS.enableHighAccuracy,
		timeout: options.timeout ?? DEFAULT_LOCATION_OPTIONS.timeout,
		maximumAge: options.maximumAge ?? DEFAULT_LOCATION_OPTIONS.maximumAge,
	};
}

/** One-off request in battery saver: a coarse fix up to a minute old will do. */
export const ONE_OFF_BATTERY_SAVER_OPTIONS: LocationOptions = {
	enableHighAccuracy: false,
	maximumAge: 60000,
};

/** Live watch while the map is open: precise fixes at most a few seconds old. */
export const LIVE_WATCH_OPTIONS: Required<LocationOptions> = {
	enableHighAccuracy: true,
	maximumAge: 5000,
	timeout: 30000,
};

/** Live watch in battery saver: coarser and older fixes are good enough. */
export const LIVE_WATCH_BATTERY_SAVER_OPTIONS: Required<LocationOptions> = {
	enableHighAccuracy: false,
	maximumAge: 30000,
	timeout: 60000,
};
