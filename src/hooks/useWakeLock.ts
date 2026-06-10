'use client';

/**
 * Screen Wake Lock while actively navigating.
 *
 * Holds a `screen` wake lock whenever `active` is true so the display does
 * not sleep mid-hike with the map open. The platform auto-releases the lock
 * when the tab is hidden; a visibilitychange listener re-acquires it when
 * the user returns. No-ops silently where the API is unsupported (Firefox
 * desktop, older Safari) or the request is denied (low battery).
 */
import { useEffect } from 'react';

export function useWakeLock(active: boolean): void {
	useEffect(() => {
		// Feature-detect: lib.dom types wakeLock as always-present, but Firefox
		// desktop and older Safari do not implement it.
		if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

		let sentinel: WakeLockSentinel | null = null;
		let disposed = false;

		const acquire = async (): Promise<void> => {
			if (disposed || document.visibilityState !== 'visible') return;
			try {
				sentinel = await navigator.wakeLock.request('screen');
				if (disposed) {
					void sentinel.release().catch(() => {});
					sentinel = null;
				}
			} catch {
				// Denied (e.g. battery saver at OS level) or unsupported: stay silent.
				sentinel = null;
			}
		};

		const onVisibility = (): void => {
			if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) {
				void acquire();
			}
		};

		void acquire();
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			disposed = true;
			document.removeEventListener('visibilitychange', onVisibility);
			if (sentinel && !sentinel.released) {
				void sentinel.release().catch(() => {});
			}
			sentinel = null;
		};
	}, [active]);
}
