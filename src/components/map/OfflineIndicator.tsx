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
			className="z-controls absolute top-20 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-gray-800/90 px-3 py-1 text-xs font-medium text-white shadow dark:bg-gray-900/90"
			role="status"
		>
			<IoCloudOfflineOutline aria-hidden className="h-3.5 w-3.5 shrink-0" />
			<span>{t('offline')}</span>
		</div>
	);
}
