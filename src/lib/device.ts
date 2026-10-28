/**
 * Detect if the user is on a mobile device (phone or tablet).
 * Combines the UA regex with a coarse-pointer + touch heuristic so modern
 * tablets that omit the legacy UA tokens are still treated as mobile.
 */
export function isMobile(): boolean {
	if (typeof navigator === 'undefined') return false;
	if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
		return true;
	}
	if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
		const coarse = window.matchMedia('(pointer: coarse)').matches;
		if (coarse && (navigator.maxTouchPoints ?? 0) > 0) return true;
	}
	return false;
}
