'use client';

/** Small pill badge that appears when the device has no network connection. */
import React from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { IoCloudOfflineOutline } from 'react-icons/io5';

export function OfflineIndicator(): React.ReactElement | null {
	const t = useTranslations('offlineIndicator');
	const isOffline = useMapStore((state: MapStoreState) => state.isOffline);

	if (!isOffline) return null;

	return (
		<div
			aria-live="polite"
			className="map-tooltip map-tooltip--banner map-tooltip--compact animate-slide-in-from-top flex items-center justify-center gap-1.5 motion-reduce:animate-none"
			role="status"
		>
			<IoCloudOfflineOutline aria-hidden className="h-3.5 w-3.5 shrink-0" />
			<span className="font-medium">{t('offline')}</span>
		</div>
	);
}
