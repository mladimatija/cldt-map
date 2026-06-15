'use client';

/**
 * Keyboard-operable "trail scrubber": a native range input (free, robust slider
 * a11y - arrows / Home / End / PageUp-Down, visible focus) that steps a cursor
 * along the route. The thumb and the spoken `aria-valuetext` update on every step
 * via a cheap binary-search lookup (local re-render only - no store write), but
 * the heavy map highlight (Leaflet marker + chart dot, which re-renders the map
 * subscribers) is committed only once the scrub settles, so dragging / holding an
 * arrow stays smooth. Section and water context narrate through the polite live
 * region on the same settle.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import { useTranslations } from 'next-intl';
import L from 'leaflet';
import { useStore, useMapStore, type StoreState, type MapStoreState } from '@/lib/store';
import { useBlockMapPropagation } from '@/hooks';
import { formatDistance, formatElevation } from '@/lib/utils';
import { findNearestPointIndex } from '@/lib/distance-utils';
import { gradeWord, nearestUsableWaterAheadKm } from '@/lib/trail-narration';

/** Wait for the scrub/keyboard action to settle before the heavy map update. */
const SCRUB_SETTLE_MS = 120;

export function TrailScrubber(): React.ReactElement | null {
	const t = useTranslations('a11y');
	const tTrail = useTranslations('trailRoute');
	const map = useMap();
	const containerRef = useRef<HTMLDivElement | null>(null);

	const enhancedTrailPoints = useStore((state: StoreState) => state.enhancedTrailPoints);
	const trailMetadata = useStore((state: StoreState) => state.trailMetadata);
	const highlightTrailPosition = useStore((state: StoreState) => state.highlightTrailPosition);
	const direction = useStore((state: StoreState) => state.direction);
	const units = useMapStore((state: MapStoreState) => state.units);
	const distancePrecision = useMapStore((state: MapStoreState) => state.distancePrecision);
	const poisFile = useMapStore((state: MapStoreState) => state.poisFile);
	const announce = useMapStore((state: MapStoreState) => state.announce);

	const totalKm = trailMetadata?.totalDistance ?? 0;
	const pointCount = enhancedTrailPoints?.length ?? 0;

	useBlockMapPropagation(containerRef, [pointCount]);

	const [value, setValue] = useState(0);
	const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastSectionRef = useRef<string | null>(null);
	const waterAnnouncedRef = useRef(false);

	useEffect(
		() => () => {
			if (settleRef.current) clearTimeout(settleRef.current);
		},
		[],
	);

	if (pointCount < 2 || totalKm <= 0) {
		return null;
	}

	// The slider value IS travel-direction distance (km from the travel-direction
	// start: left = start, right = end). That equals EnhancedTrailPoint
	// .distanceFromStart - the same space the highlight pipeline and the elevation
	// chart use (trail-compute reverses the points for NOBO) - so the highlight and
	// aria text use the value directly. Only poi.trailKm is fixed SOBO km, so we
	// convert just for the water lookup below.
	const clamp = (v: number): number => Math.min(totalKm, Math.max(0, v));
	const pointAtValue = (v: number): (typeof enhancedTrailPoints)[number] =>
		enhancedTrailPoints[findNearestPointIndex(enhancedTrailPoints, clamp(v) * 1000)];

	const current = pointAtValue(value);
	const ariaValueText = t('position', {
		distance: formatDistance(current.distanceFromStart / 1000, units, distancePrecision),
		elevation: formatElevation(current.elevation, units),
		grade: t(`grade.${gradeWord(current.gradePct)}`),
	});

	// Heavy update, deferred until the scrub settles.
	const commit = (v: number): void => {
		const travelKm = clamp(v);
		highlightTrailPosition({ distance: travelKm * 1000 });
		const point = useStore.getState().highlightedTrailPoint;
		if (!point) return;
		const latLng = L.latLng(point.lat, point.lng);
		if (!map.getBounds().contains(latLng)) {
			map.panTo(latLng, { animate: false });
		}
		const section = point.sectionName ?? null;
		if (section && section !== lastSectionRef.current) {
			lastSectionRef.current = section;
			announce(t('enteringSection', { section: tTrail(section) }));
		}
		// poi.trailKm is fixed SOBO km, so convert the travel-direction position.
		const soboKm = direction === 'SOBO' ? travelKm : totalKm - travelKm;
		const waterKm = nearestUsableWaterAheadKm(soboKm, poisFile?.pois, direction);
		if (waterKm !== null && !waterAnnouncedRef.current) {
			waterAnnouncedRef.current = true;
			announce(t('waterAhead', { distance: formatDistance(waterKm, units, distancePrecision) }));
		} else if (waterKm === null) {
			waterAnnouncedRef.current = false;
		}
	};

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
		const v = Number(event.target.value);
		if (!Number.isFinite(v)) return;
		setValue(v); // cheap: moves the thumb + updates aria-valuetext immediately
		if (settleRef.current) clearTimeout(settleRef.current);
		settleRef.current = setTimeout(() => {
			settleRef.current = null;
			commit(v);
		}, SCRUB_SETTLE_MS);
	};

	return (
		<div
			className="z-map-overlay rounded bg-white px-3 py-1.5 shadow-lg dark:border dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)]"
			ref={containerRef}
		>
			<label className="sr-only" htmlFor="trail-scrubber">
				{t('scrubberLabel')}
			</label>
			<input
				aria-valuetext={ariaValueText}
				className="precision-slider w-full"
				id="trail-scrubber"
				max={totalKm}
				min={0}
				step={0.1}
				type="range"
				value={value}
				onChange={handleChange}
			/>
		</div>
	);
}
