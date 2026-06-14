/** Shared PWA install prompt guardrails (session dismiss, cooldown, standalone). */

export const SESSION_DISMISS_KEY = 'cldt-map-pwa-install-dismissed';
export const COOLDOWN_DAYS = 7;
export const COOLDOWN_KEY = 'cldt-map-pwa-install-dismissed-until';
export const OFFLINE_NUDGE_SHOWN_KEY = 'cldt-map-pwa-offline-nudge-shown';

export function isStandalone(): boolean {
	if (typeof window === 'undefined') return false;

	const isDisplayModeStandalone = window.matchMedia('(display-mode: standalone)').matches;
	const isIosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

	return isDisplayModeStandalone || isIosStandalone;
}

export function canShowPwaInstallPrompt(): boolean {
	if (typeof window === 'undefined') return false;
	if (sessionStorage.getItem(SESSION_DISMISS_KEY)) return false;
	const until = localStorage.getItem(COOLDOWN_KEY);
	if (until) {
		const ts = Number(until);
		if (!Number.isNaN(ts) && Date.now() < ts) return false;
	}
	return true;
}

export function dismissPwaInstallPrompt(): void {
	sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
	localStorage.setItem(COOLDOWN_KEY, String(Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000));
}

export function canShowOfflineInstallNudge(): boolean {
	if (typeof window === 'undefined') return false;
	return !localStorage.getItem(OFFLINE_NUDGE_SHOWN_KEY);
}

export function markOfflineInstallNudgeShown(): void {
	localStorage.setItem(OFFLINE_NUDGE_SHOWN_KEY, '1');
}

/** iOS Safari has no beforeinstallprompt; show manual Add to Home Screen hint instead. */
export function isIosInstallHint(): boolean {
	if (typeof window === 'undefined') return false;
	const ua = window.navigator.userAgent;
	const isIosDevice =
		/iPad|iPhone|iPod/.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
	return isIosDevice && !isStandalone();
}
