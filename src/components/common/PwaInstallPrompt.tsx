'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { useMapStore, type MapStoreState } from '@/lib/store';
import {
	canShowOfflineInstallNudge,
	canShowPwaInstallPrompt,
	dismissPwaInstallPrompt,
	isIosInstallHint,
	isStandalone,
	markOfflineInstallNudgeShown,
} from '@/lib/pwa-install';

type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<{ outcome: 'accepted' | 'dismissed' }>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type BannerMode = 'generic' | 'offline';

/**
 * Optional PWA install prompt: non-intrusive, dismissible, low-frequency.
 * Generic copy on beforeinstallprompt; contextual copy after the first manual offline download.
 */
export default function PwaInstallPrompt(): React.ReactElement | null {
	const t = useTranslations('pwa');
	const pwaInstallTrigger = useMapStore((s: MapStoreState) => s.pwaInstallTrigger);
	const clearPwaInstallTrigger = useMapStore((s: MapStoreState) => s.clearPwaInstallTrigger);
	const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
	const [userDismissed, setUserDismissed] = useState(false);
	const [bannerMode, setBannerMode] = useState<BannerMode | null>(null);

	const iosHint = isIosInstallHint();
	const promptAllowed = canShowPwaInstallPrompt() && !isStandalone() && !userDismissed;

	useEffect(() => {
		if (typeof window === 'undefined' || isStandalone()) return;

		const handleBeforeInstall = (e: Event): void => {
			e.preventDefault();
			const installEvent = e as BeforeInstallPromptEvent;
			if (typeof installEvent.prompt !== 'function') return;
			setDeferredPrompt(installEvent);
			if (!canShowPwaInstallPrompt()) return;
			if (useMapStore.getState().pwaInstallTrigger === 'offlineDownload') return;
			setBannerMode('generic');
		};

		window.addEventListener('beforeinstallprompt', handleBeforeInstall);
		return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
	}, []);

	useEffect(() => {
		if (pwaInstallTrigger !== 'offlineDownload') return;
		if (!canShowPwaInstallPrompt() || !canShowOfflineInstallNudge() || isStandalone()) {
			clearPwaInstallTrigger();
			return;
		}
		if (!deferredPrompt && !iosHint) return;

		const id = window.requestAnimationFrame(() => {
			setBannerMode('offline');
			clearPwaInstallTrigger();
		});
		return () => window.cancelAnimationFrame(id);
	}, [pwaInstallTrigger, deferredPrompt, iosHint, clearPwaInstallTrigger]);

	const showOfflineBanner = promptAllowed && bannerMode === 'offline' && (deferredPrompt !== null || iosHint);
	const showGenericBanner = promptAllowed && bannerMode === 'generic' && deferredPrompt !== null;
	const showBanner = showOfflineBanner || showGenericBanner;
	const isOfflineContext = bannerMode === 'offline';

	const handleInstall = useCallback(async () => {
		if (!deferredPrompt) return;
		const e = deferredPrompt;
		try {
			await e.prompt();
			const choice =
				e.userChoice !== null && typeof (e.userChoice as Promise<unknown>).then === 'function'
					? await e.userChoice
					: { outcome: 'dismissed' as const };
			if (choice.outcome === 'accepted') {
				setUserDismissed(true);
				if (isOfflineContext) markOfflineInstallNudgeShown();
			}
		} catch {
			setUserDismissed(true);
		}
		setDeferredPrompt(null);
		setBannerMode(null);
	}, [deferredPrompt, isOfflineContext]);

	const handleDismiss = useCallback(() => {
		dismissPwaInstallPrompt();
		setUserDismissed(true);
		if (bannerMode === 'offline') markOfflineInstallNudgeShown();
		setBannerMode(null);
		clearPwaInstallTrigger();
	}, [bannerMode, clearPwaInstallTrigger]);

	if (!showBanner) return null;
	if (!deferredPrompt && !(isOfflineContext && iosHint)) return null;

	const title = isOfflineContext ? t('installTitleOffline') : t('installTitle');
	const description = isOfflineContext
		? deferredPrompt
			? t('installDescriptionOffline')
			: t('installDescriptionOfflineIos')
		: t('installDescription');

	return (
		<div aria-label={title} className="map-tooltip map-tooltip--pwa" role="dialog">
			<p className="font-medium">{title}</p>
			<p>{description}</p>
			<div className="mt-2 flex flex-wrap items-center justify-end gap-2">
				<Button variant="mapTooltipSecondary" onClick={handleDismiss}>
					{t('dismiss')}
				</Button>
				{deferredPrompt ? (
					<Button variant="mapTooltipPrimary" onClick={handleInstall}>
						{t('install')}
					</Button>
				) : null}
			</div>
		</div>
	);
}
