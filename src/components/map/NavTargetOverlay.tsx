'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { IoArrowUp, IoLocateOutline } from 'react-icons/io5';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { Button } from '@/components/ui/Button';
import { haversineDistanceM } from '@/lib/haversine';
import { computeBearing } from '@/lib/distance-utils';
import { formatDistance } from '@/lib/utils';
import { bearingToCompass } from '@/lib/emergency-data';

/**
 * Live navigation-target HUD. When the user has pinned a POI/waypoint as a
 * target (`navTarget`), this shows the straight-line distance plus an upward
 * arrow rotated to the geographic bearing - the map is north-up, so the arrow
 * points where the target lies on screen - and the localized cardinal
 * direction. Straight-line "which way + how far" only; it never routes.
 *
 * Mounted as a top-left overlay (clear of the top-right distance HUD and the
 * centre banner slot). Until a GPS fix arrives it shows a waiting state so the
 * pin is acknowledged even indoors / before permission is granted.
 */
export function NavTargetOverlay(): React.ReactElement | null {
	const t = useTranslations('navTarget');
	const tCompass = useTranslations('emergency');
	const navTarget = useMapStore((s: MapStoreState) => s.navTarget);
	const clearNavTarget = useMapStore((s: MapStoreState) => s.clearNavTarget);
	const userLocation = useMapStore((s: MapStoreState) => s.userLocation);
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);

	if (!navTarget) return null;

	const distanceM = userLocation
		? haversineDistanceM(userLocation.lat, userLocation.lng, navTarget.lat, navTarget.lng)
		: null;
	const bearing = userLocation
		? computeBearing(userLocation.lat, userLocation.lng, navTarget.lat, navTarget.lng)
		: null;
	const compassLabel = bearing !== null ? tCompass(`compass.${bearingToCompass(bearing)}`) : null;
	const distanceLabel = distanceM !== null ? formatDistance(distanceM, units, distancePrecision, true) : null;

	const srText =
		compassLabel && distanceLabel
			? t('srHeading', { compass: compassLabel, distance: distanceLabel, name: navTarget.name })
			: t('srWaiting', { name: navTarget.name });

	return (
		<div className="z-controls absolute top-2 left-2 flex max-w-[15rem] min-w-[9rem] items-center gap-2 rounded-lg bg-white/90 px-3 py-2 text-xs font-medium text-gray-800 shadow dark:bg-[var(--bg-secondary)]/90 dark:text-[var(--text-primary)]">
			<span
				aria-hidden="true"
				className="bg-cldt-blue/10 text-cldt-blue dark:bg-cldt-blue/20 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
			>
				{bearing !== null ? (
					<IoArrowUp className="h-4 w-4" style={{ transform: `rotate(${Math.round(bearing)}deg)` }} />
				) : (
					<IoLocateOutline className="h-4 w-4 animate-pulse motion-reduce:animate-none" />
				)}
			</span>
			<span aria-hidden="true" className="flex min-w-0 flex-1 flex-col leading-tight">
				<span className="truncate" title={navTarget.name}>
					{navTarget.name}
				</span>
				<span className="text-gray-500 dark:text-[var(--text-secondary)]">
					{compassLabel && distanceLabel ? `${compassLabel} · ${distanceLabel}` : t('waitingForGps')}
				</span>
			</span>
			<span className="sr-only">{srText}</span>
			<Button aria-label={t('clear')} variant="closeIcon" onClick={clearNavTarget}>
				×
			</Button>
		</div>
	);
}
