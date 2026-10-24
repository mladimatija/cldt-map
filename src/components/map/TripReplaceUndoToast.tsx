'use client';

import React, { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { useMapStore, type MapStoreState } from '@/lib/store';

/** Long enough to read the line and reach the button. */
const TOAST_MS = 12_000;

/** After a share link replaced the local trip data: an undo that restores the backup. */
export function TripReplaceUndoToast(): React.ReactElement | null {
	const replacedAt = useMapStore((s: MapStoreState) => s.tripReplaceUndoAt);
	const dismiss = useMapStore((s: MapStoreState) => s.dismissTripReplaceUndo);
	const restore = useMapStore((s: MapStoreState) => s.restoreTripBackup);
	const t = useTranslations('shareImport');

	// Keyed on the replace time, so a second replace restarts the timer.
	useEffect(() => {
		if (replacedAt === null) return;
		const id = window.setTimeout(() => dismiss(), TOAST_MS);
		return () => window.clearTimeout(id);
	}, [replacedAt, dismiss]);

	if (replacedAt === null) return null;

	return (
		<div
			aria-live="polite"
			className="map-tooltip map-tooltip--pwa animate-slide-in-from-top motion-reduce:animate-none"
			role="status"
		>
			<p className="font-medium">{t('replacedToast')}</p>
			<div className="mt-2 flex justify-end">
				<Button variant="mapTooltipPrimary" onClick={() => restore()}>
					{t('undo')}
				</Button>
			</div>
		</div>
	);
}
