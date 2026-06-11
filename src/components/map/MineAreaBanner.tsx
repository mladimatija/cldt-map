'use client';

import React, { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { classifyMineProximity, hasMineAreas, MINE_NEAR_BUFFER_M } from '@/lib/mine-areas';
import { formatDistance } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { BANNER_REGION_CLASSES, BANNER_ROW_CLASSES, BANNER_RED_CLASSES } from './banner-styles';

const DISMISSED_KEY = 'cldt-dismissed-mine-warnings';

function quantize(n: number): number {
	return Math.round(n * 10000) / 10000;
}

function getDismissed(): Set<string> {
	try {
		const raw = sessionStorage.getItem(DISMISSED_KEY);
		return new Set(raw ? (JSON.parse(raw) as string[]) : []);
	} catch {
		return new Set();
	}
}

function persistDismissed(id: string): void {
	try {
		const set = getDismissed();
		set.add(id);
		sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
	} catch {
		// sessionStorage unavailable - dismiss is in-memory only
	}
}

/**
 * GPS-triggered mine-suspected-area warning, same strip-banner mechanics as
 * SevereWeatherBanner. A fix INSIDE a polygon raises a non-dismissible red
 * banner (like red weather warnings); a fix within the 500 m buffer raises a
 * dismissible amber one. Independent of the layer toggle on purpose: hiding
 * the polygons must not silence the proximity warning.
 */
export function MineAreaBanner(): React.ReactElement | null {
	const t = useTranslations('mineAreas');
	const file = useMapStore((s: MapStoreState) => s.mineAreasFile);
	const coarseLocationKey = useMapStore((s: MapStoreState) =>
		s.userLocation ? `${quantize(s.userLocation.lat)},${quantize(s.userLocation.lng)}` : null,
	);
	const units = useMapStore((s: MapStoreState) => s.units);
	const [dismissed, setDismissed] = useState<Set<string>>(() => getDismissed());

	const warnings = useMemo((): { id: string; proximity: 'inside' | 'near' }[] => {
		if (!coarseLocationKey || !hasMineAreas(file)) return [];
		const [lat, lng] = coarseLocationKey.split(',').map(Number);
		const out: { id: string; proximity: 'inside' | 'near' }[] = [];
		for (const area of file.areas) {
			const prox = classifyMineProximity(lat, lng, area);
			if (prox) out.push({ id: area.id, proximity: prox });
		}
		// Inside outranks near; one banner per area.
		out.sort((a, b) => (a.proximity === b.proximity ? 0 : a.proximity === 'inside' ? -1 : 1));
		return out;
	}, [coarseLocationKey, file]);

	const visible = warnings.filter((w) => w.proximity === 'inside' || !dismissed.has(w.id));
	if (visible.length === 0) return null;

	const handleDismiss = (id: string): void => {
		persistDismissed(id);
		setDismissed((prev) => new Set([...prev, id]));
	};

	const bufferLabel = formatDistance(MINE_NEAR_BUFFER_M, units, 1, true);

	return (
		<div aria-label={t('popoutTitle')} className={BANNER_REGION_CLASSES} role="region">
			{visible.map((w) => (
				<div
					className={`${BANNER_ROW_CLASSES} ${w.proximity === 'inside' ? BANNER_RED_CLASSES : 'bg-amber-400 text-amber-900'}`}
					key={w.id}
					role="alert"
				>
					<div className="min-w-0 flex-1">
						<span className="font-semibold">{t('popoutTitle')}</span>
						<span className="ml-1">
							{w.proximity === 'inside' ? t('bannerInside') : t('bannerNear', { distance: bufferLabel })}
						</span>
					</div>
					{w.proximity === 'near' && (
						<Button aria-label={t('dismiss')} variant="bannerClose" onClick={() => handleDismiss(w.id)}>
							×
						</Button>
					)}
				</div>
			))}
		</div>
	);
}
