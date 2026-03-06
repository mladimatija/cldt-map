'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';

const SESSION_DISMISS_KEY = 'cldt-map-pwa-install-dismissed';
const COOLDOWN_DAYS = 7;
const COOLDOWN_KEY = 'cldt-map-pwa-install-dismissed-until';

type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<{ outcome: 'accepted' | 'dismissed' }>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isStandalone(): boolean {
	if (typeof window === 'undefined') return false;

	const isDisplayModeStandalone = window.matchMedia('(display-mode: standalone)').matches;
	const isIosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone!;

	return isDisplayModeStandalone || isIosStandalone;
}

function canShowPrompt(): boolean {
	if (typeof window === 'undefined') return false;
	if (sessionStorage.getItem(SESSION_DISMISS_KEY)) return false;
	const until = localStorage.getItem(COOLDOWN_KEY);
	if (until) {
		const ts = Number(until);
		if (!Number.isNaN(ts) && Date.now() < ts) return false;
	}
	return true;
}

/**
 * Optional PWA install prompt: non-intrusive, dismissible, low-frequency.
 * Shows when beforeinstallprompt fires and not dismissed this session or in cooldown (7 days).
 */
export default function PwaInstallPrompt(): React.ReactElement | null {
	const t = useTranslations('pwa');
	const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
	const [showBanner, setShowBanner] = useState(false);

	useEffect(() => {
		if (typeof window === 'undefined' || isStandalone()) return;

		const handleBeforeInstall = (e: Event): void => {
			e.preventDefault();
			const installEvent = e as BeforeInstallPromptEvent;
			// Only store and show when the event has prompt() (real browser event). Ignore synthetic events.
			if (typeof installEvent.prompt !== 'function') return;
			setDeferredPrompt(installEvent);
			if (canShowPrompt()) setShowBanner(true);
		};

		window.addEventListener('beforeinstallprompt', handleBeforeInstall);
		return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
	}, []);

	const handleInstall = useCallback(async () => {
		if (!deferredPrompt) return;
		const e = deferredPrompt;
		try {
			await e.prompt();
			const choice =
				e.userChoice !== null && typeof (e.userChoice as Promise<unknown>).then === 'function'
					? await e.userChoice
					: { outcome: 'dismissed' as const };
			if (choice.outcome === 'accepted') setShowBanner(false);
		} catch {
			// Simulated event in dev, or prompt no longer valid — just close banner
			setShowBanner(false);
		}
		setDeferredPrompt(null);
	}, [deferredPrompt]);

	const handleDismiss = useCallback(() => {
		sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
		localStorage.setItem(COOLDOWN_KEY, String(Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000));
		setShowBanner(false);
	}, []);

	if (!showBanner || !deferredPrompt) return null;

	return (
		<div aria-label={t('installTitle')} className="map-tooltip map-tooltip--pwa" role="dialog">
			<p className="font-medium">{t('installTitle')}</p>
			<p>{t('installDescription')}</p>
			<div className="mt-2 flex flex-wrap items-center justify-end gap-2">
				<Button variant="mapTooltipSecondary" onClick={handleDismiss}>
					{t('dismiss')}
				</Button>
				<Button variant="mapTooltipPrimary" onClick={handleInstall}>
					{t('install')}
				</Button>
			</div>
		</div>
	);
}
