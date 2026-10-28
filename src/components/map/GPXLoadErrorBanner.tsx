'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { refreshGPXCache } from '@/lib/gpx-cache';
import { Button } from '@/components/ui/Button';

/**
 * Banner shown when GPX trail data fails to load. Offers dismiss and retry.
 */
export default function GPXLoadErrorBanner(): React.ReactElement | null {
	const t = useTranslations('common');
	const gpxLoadFailed = useStore((state: StoreState) => state.gpxLoadFailed);
	const setGpxLoadFailed = useStore((state: StoreState) => state.setGpxLoadFailed);
	const setReloadTrailRequested = useMapStore((state: MapStoreState) => state.setReloadTrailRequested);

	const handleDismiss = (): void => setGpxLoadFailed(false);

	const handleRetry = async (): Promise<void> => {
		setGpxLoadFailed(false);
		await refreshGPXCache();
		setReloadTrailRequested(Date.now());
	};

	if (!gpxLoadFailed) return null;

	return (
		<div className="map-tooltip map-tooltip--banner animate-slide-in-from-top" role="alert">
			<Button aria-label={t('close')} className="user-location-close-btn" variant="closeIcon" onClick={handleDismiss}>
				×
			</Button>
			<p>{t('failedToLoadTrail')}</p>
			<div className="flex justify-center gap-2">
				<Button variant="mapTooltipPrimary" onClick={handleRetry}>
					{t('retry')}
				</Button>
			</div>
		</div>
	);
}
