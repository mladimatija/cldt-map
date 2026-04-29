export type GeolocationPermissionState = 'granted' | 'denied' | 'prompt';

/**
 * Query the current geolocation permission state via Permissions API.
 * Resolves to 'prompt' if API is unavailable or fails.
 */
export async function getGeolocationPermissionState(): Promise<GeolocationPermissionState> {
	if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
		return 'prompt';
	}
	try {
		const result = await navigator.permissions.query({ name: 'geolocation' });
		return result.state;
	} catch {
		return 'prompt';
	}
}

/**
 * Subscribe to geolocation permission changes.
 * @param callback Called when permission state changes.
 * @returns Unsubscribe function. No-op if Permissions API is not supported.
 */
export function addGeolocationPermissionListener(callback: (state: GeolocationPermissionState) => void): () => void {
	if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
		return () => {};
	}
	let permissionResult: PermissionStatus | null = null;

	const setup = (): void => {
		navigator.permissions
			.query({ name: 'geolocation' })
			.then((result) => {
				permissionResult = result;
				callback(result.state);
				result.onchange = () => callback(result.state);
			})
			.catch(() => callback('prompt'));
	};

	setup();

	return () => {
		if (permissionResult) {
			permissionResult.onchange = null;
			permissionResult = null;
		}
	};
}
