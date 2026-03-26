'use client';

/** Session-once toast that appears on launch when the tile cache is stale. */
import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { tileCacheTtlDays } from '@/lib/config';
import { Button } from '@/components/ui/Button';
import { IoWarningOutline } from 'react-icons/io5';

const SESSION_KEY = 'stale-cache-dismissed';

export function StaleCacheNotification(): React.ReactElement | null {
	const t = useTranslations('staleCacheNotification');
	const showStaleCacheNotification = useMapStore((s: MapStoreState) => s.showStaleCacheNotification);
	const setStaleCacheNotification = useMapStore((s: MapStoreState) => s.setStaleCacheNotification);
	const [sessionDismissed, setSessionDismissed] = useState(() => !!sessionStorage.getItem(SESSION_KEY));

	const handleDismiss = (): void => {
		sessionStorage.setItem(SESSION_KEY, '1');
		setStaleCacheNotification(false);
		setSessionDismissed(true);
	};

	if (!showStaleCacheNotification || sessionDismissed) return null;

	return (
		<div aria-live="polite" className="map-tooltip map-tooltip--banner" role="alert">
			<Button aria-label={t('dismiss')} className="user-location-close-btn" variant="closeIcon" onClick={handleDismiss}>
				×
			</Button>
			<div className="flex items-start gap-2">
				<IoWarningOutline aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
				<div className="flex-1">
					<p className="mb-1 font-medium">{t('title')}</p>
					<p className="text-xs opacity-80">{t('description', { days: tileCacheTtlDays })}</p>
				</div>
			</div>
		</div>
	);
}
