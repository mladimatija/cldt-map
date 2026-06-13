'use client';

import React, { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useMapStore, type MapStoreState } from '@/lib/store';

const TOAST_MS = 1500;

/** Top-right chip for share-link copy success or failure (map + POI + waypoint). */
export function ShareCopyToast(): React.ReactElement | null {
	const toast = useMapStore((s: MapStoreState) => s.shareCopyToast);
	const clearShareCopyToast = useMapStore((s: MapStoreState) => s.clearShareCopyToast);
	const tMap = useTranslations('mapControls');
	const tPois = useTranslations('pois');

	useEffect(() => {
		if (!toast) return;
		const id = window.setTimeout(() => clearShareCopyToast(), TOAST_MS);
		return () => window.clearTimeout(id);
	}, [toast, clearShareCopyToast]);

	if (!toast) return null;

	const isError = toast.status === 'error';
	const message = isError ? tPois('shareFailed') : toast.short ? tMap('linkCopiedShort') : tMap('linkCopied');

	return (
		<div
			aria-live={isError ? 'assertive' : 'polite'}
			className={cn(
				'map-tooltip map-tooltip--pwa animate-slide-in-from-top motion-reduce:animate-none',
				isError && 'map-tooltip--error',
			)}
			role={isError ? 'alert' : 'status'}
		>
			<p className="font-medium">{message}</p>
		</div>
	);
}
