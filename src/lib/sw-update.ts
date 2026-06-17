/**
 * Single source of truth for "is a genuine app update waiting?".
 *
 * True only when a newer service worker is installed and parked in `waiting`
 * AND a prior worker already controls the page. The controller gate is the
 * non-obvious part: on a first install the SW briefly flickers through the
 * waiting state with no controller, which must NOT count as an update (it would
 * show a bogus "new version" prompt to first-time visitors). Both the update
 * prompt (ServiceWorkerProvider) and the offline-readiness readout
 * (CacheHealthStatus) read this predicate so the invariant lives in one place.
 */
export function isAppUpdateWaiting(reg: ServiceWorkerRegistration | null | undefined): boolean {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
	return !!reg?.waiting && !!navigator.serviceWorker.controller;
}

/**
 * Resolves whether a genuine app update is waiting by querying the active
 * service-worker registration. Read-only; resolves false when the SW API is
 * unavailable or the lookup fails. Keeps all navigator.serviceWorker reads for
 * the offline-readiness readout in this module, next to the predicate.
 */
export async function getAppUpdateWaiting(): Promise<boolean> {
	if (typeof navigator === 'undefined' || typeof navigator.serviceWorker?.getRegistration !== 'function') return false;
	try {
		return isAppUpdateWaiting(await navigator.serviceWorker.getRegistration());
	} catch {
		return false;
	}
}
