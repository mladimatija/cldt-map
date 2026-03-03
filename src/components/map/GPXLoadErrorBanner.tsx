'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { clearGPXCache } from '@/lib/gpx-cache';

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
			<button aria-label={t('close')} className="user-location-close-btn" type="button" onClick={handleDismiss}>
				×
			</button>
			<p>{t('failedToLoadTrail')}</p>
			<div className="map-tooltip__actions">
				<button
					className="!text-cldt-blue hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green cursor-pointer rounded-md border border-gray-200 bg-white px-4 py-2 font-medium transition-all outline-none"
					type="button"
					onClick={handleRetry}
				>
					{t('retry')}
				</button>
			</div>
		</div>
	);
}
