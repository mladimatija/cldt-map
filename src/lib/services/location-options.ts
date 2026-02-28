/** Options for geolocation requests (getCurrentPosition / watchPosition). */
export interface LocationOptions {
	enableHighAccuracy?: boolean;
	timeout?: number;
	maximumAge?: number;
}

/** Default values for location requests. */
export const DEFAULT_LOCATION_OPTIONS: Required<LocationOptions> = {
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
