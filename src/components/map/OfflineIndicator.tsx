'use client';

/** Small pill badge that appears when the device has no network connection. */
import React from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { IoCloudOfflineOutline } from 'react-icons/io5';
import { COMPACT_BANNER_CHIP_CLASSES } from './banner-styles';

export function OfflineIndicator(): React.ReactElement | null {
	const t = useTranslations('offlineIndicator');
	const isOffline = useMapStore((state: MapStoreState) => state.isOffline);
	const demoModeActive = useMapStore((state: MapStoreState) => state.demoModeActive);

	// The demo banner owns the top-center slot; suppress this pill while a demo
	// session is active so it never paints over the demo Exit button.
	if (!isOffline || demoModeActive) return null;

	return (
		<div aria-live="polite" className={COMPACT_BANNER_CHIP_CLASSES} role="status">
			<IoCloudOfflineOutline aria-hidden className="h-3.5 w-3.5 shrink-0" />
			<span className="font-medium">{t('offline')}</span>
		</div>
	);
}
