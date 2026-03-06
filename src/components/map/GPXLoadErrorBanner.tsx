'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { clearGPXCache } from '@/lib/gpx-cache';
import { Button } from '@/components/ui/Button';

/**
 * Banner shown when GPX trail data fails to load. Offers dismiss and retry.
 */
export default function GPXLoadErrorBanner(): React.ReactElement | null {
	const t = useTranslations('common');
	const gpxLoadFailed = useMapStore((state: MapStoreState) => state.gpxLoadFailed);
	const setGpxLoadFailed = useMapStore((state: MapStoreState) => state.setGpxLoadFailed);
	const setReloadTrailRequested = useMapStore((state: MapStoreState) => state.setReloadTrailRequested);

	const handleDismiss = (): void => setGpxLoadFailed(false);

	const handleRetry = async (): Promise<void> => {
		setGpxLoadFailed(false);
		await clearGPXCache();
		setReloadTrailRequested(Date.now());
	};

	if (!gpxLoadFailed) return null;

	return (
		<div className="map-tooltip map-tooltip--banner animate-slide-in-from-top" role="alert">
			<Button
				aria-label={t('close')}
				className="user-location-close-btn"
				variant="closeIcon"
				onClick={handleDismiss}
			>
				×
			</Button>
			<p>{t('failedToLoadTrail')}</p>
			<div className="map-tooltip__actions">
				<Button variant="mapTooltipPrimary" onClick={handleRetry}>
					{t('retry')}
				</Button>
			</div>
		</div>
	);
}
