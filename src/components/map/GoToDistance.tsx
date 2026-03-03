'use client';

/**
 * Compact "Go to [km/mi]" search at the top center. Flies the map to the trail point at the given
 * distance from the start and opens the trail tooltip. Reuses enhancedTrailPoints and map.flyTo.
 */
import React, { useState, useCallback, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { useStore, useMapStore, type StoreState, type MapStoreState } from '@/lib/store';
import { useBlockMapPropagation } from '@/hooks';
import { useTranslations } from 'next-intl';
import {
	MAP_CONTROL_POPOVER,
	MAP_CONTROL_BTN_OUTLINE,
	MAP_CONTROL_INPUT,
} from '@/components/map/controls/map-controls-constants';
import { kmToMiles, milesToKm } from '@/lib/utils';

export default function GoToDistance(): React.ReactElement | null {
	const t = useTranslations('goToDistance');
	const map = useMap();
	const gpxLoaded = useMapStore((state: MapStoreState) => state.gpxLoaded);
	const gpxLoadFailed = useMapStore((state: MapStoreState) => state.gpxLoadFailed);
	const units = useMapStore((state: MapStoreState) => state.units);
	const enhancedTrailPoints = useStore((state: StoreState) => state.enhancedTrailPoints);
	const trailMetadata = useStore((state: StoreState) => state.trailMetadata);
	const highlightTrailPosition = useStore((state: StoreState) => state.highlightTrailPosition);
	const setTooltipPinnedFromShare = useStore((state: StoreState) => state.setTooltipPinnedFromShare);

	const containerRef = useRef<HTMLDivElement>(null);

	const totalKm = trailMetadata?.totalDistance ?? 0;
	const totalMi = kmToMiles(totalKm);
	const unitLabel = units === 'imperial' ? t('mi') : t('km');

	// Re-run when the bar mounts (we return null until the trail is loaded, so the ref is set only after the first real render)
	useBlockMapPropagation(containerRef, [gpxLoaded, enhancedTrailPoints?.length, totalKm]);

	const [value, setValue] = useState('');
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = useCallback(
		(e: React.SyntheticEvent<HTMLFormElement>) => {
			e.preventDefault();
			setError(null);
			const trimmed = value.trim();
			if (!trimmed) return;
			const num = Number.parseFloat(trimmed.replace(',', '.'));
			const maxVal = units === 'imperial' ? totalMi : totalKm;
			if (Number.isNaN(num) || num < 0 || num > maxVal) {
				setError(t('invalidNumber'));
				return;
			}
			const distanceM = (units === 'imperial' ? milesToKm(num) : num) * 1000;
			if (!enhancedTrailPoints?.length) return;
			let closest = enhancedTrailPoints[0];
			let minDiff = Math.abs(closest.distanceFromStart - distanceM);
			for (let i = 1; i < enhancedTrailPoints.length; i++) {
				const d = Math.abs(enhancedTrailPoints[i].distanceFromStart - distanceM);
				if (d < minDiff) {
					minDiff = d;
					closest = enhancedTrailPoints[i];
				}
			}
			const zoom = Math.max(map.getZoom(), 12);
			map.flyTo([closest.lat, closest.lng], zoom, { duration: 0.5 });
			highlightTrailPosition?.({ distance: closest.distanceFromStart });
			setTooltipPinnedFromShare?.(true);
			setValue('');
		},
		[value, units, totalMi, totalKm, enhancedTrailPoints, map, highlightTrailPosition, setTooltipPinnedFromShare, t],
	);

	if (gpxLoadFailed || !gpxLoaded || !enhancedTrailPoints?.length || totalKm <= 0) return null;

	return (
		<div className="z-controls absolute top-4 left-1/2 -translate-x-1/2" ref={containerRef}>
			<form className={`flex items-center gap-2 ${MAP_CONTROL_POPOVER}`} onSubmit={handleSubmit}>
				<label className="sr-only" htmlFor="go-to-distance-input">
					{t('label')}
				</label>
				<span className="text-cldt-blue-contrast text-sm font-medium whitespace-nowrap dark:text-white">
					{t('goTo')}
				</span>
				<input
					aria-describedby={error ? 'go-to-distance-error' : undefined}
					aria-invalid={!!error}
					className={MAP_CONTROL_INPUT}
					id="go-to-distance-input"
					inputMode="decimal"
					placeholder={units === 'imperial' ? `0–${totalMi.toFixed(0)}` : `0–${totalKm.toFixed(0)}`}
					type="text"
					value={value}
					onChange={(e) => {
						setValue(e.target.value);
						setError(null);
					}}
				/>
				<span className="text-cldt-blue-contrast text-sm font-medium dark:text-white">{unitLabel}</span>
				<button className={`${MAP_CONTROL_BTN_OUTLINE} ml-auto`} type="submit">
					{t('go')}
				</button>
			</form>
			{error && (
				<p className="map-tooltip map-tooltip--error mt-1 text-center text-xs" id="go-to-distance-error">
					{error}
				</p>
			)}
		</div>
	);
}
