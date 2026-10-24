import { useEffect } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';

/**
 * Keeps the live location watch running while the map is open and visible:
 * whenever the permission is granted, live tracking is on and no fake position
 * is in use. The watch restarts when battery saver changes (different fix
 * options). It stops while the page is hidden, so GPS does not run in the
 * background, and starts again when the page is visible (some mobile browsers
 * drop a watch in the background anyway).
 */
export function useLocationTracking(): void {
	const permissionStatus = useMapStore((s: MapStoreState) => s.permissionStatus);
	const liveTrackingEnabled = useMapStore((s: MapStoreState) => s.liveTrackingEnabled);
	const fakeUserLocationEnabled = useMapStore((s: MapStoreState) => s.fakeUserLocationEnabled);
	const batterySaverMode = useMapStore((s: MapStoreState) => s.batterySaverMode);

	const active = permissionStatus === 'granted' && liveTrackingEnabled && !fakeUserLocationEnabled;

	useEffect(() => {
		if (!active) return;
		const { startLocationTracking, stopLocationTracking } = useMapStore.getState();
		if (document.visibilityState !== 'hidden') startLocationTracking();
		const onVisibilityChange = (): void => {
			if (document.visibilityState === 'visible') startLocationTracking();
			else stopLocationTracking();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		return () => {
			document.removeEventListener('visibilitychange', onVisibilityChange);
			stopLocationTracking();
		};
	}, [active, batterySaverMode]);
}
