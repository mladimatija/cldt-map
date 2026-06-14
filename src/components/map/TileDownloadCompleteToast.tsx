'use client';

import React, { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';

const TOAST_MS = 2000;

/** Brief success chip after a manual offline tile download completes. */
export function TileDownloadCompleteToast(): React.ReactElement | null {
	const show = useMapStore((s: MapStoreState) => s.tileDownloadCompleteToast);
	const clearTileDownloadCompleteToast = useMapStore((s: MapStoreState) => s.clearTileDownloadCompleteToast);
	const t = useTranslations('tileCache');

	useEffect(() => {
		if (!show) return;
		const id = window.setTimeout(() => clearTileDownloadCompleteToast(), TOAST_MS);
		return () => window.clearTimeout(id);
	}, [show, clearTileDownloadCompleteToast]);

	if (!show) return null;

	return (
		<div
			aria-live="polite"
			className="map-tooltip map-tooltip--pwa animate-slide-in-from-top fixed top-4 right-4 z-[var(--z-toast)] motion-reduce:animate-none"
			role="status"
		>
			<p className="font-medium">{t('downloadComplete')}</p>
		</div>
	);
}
