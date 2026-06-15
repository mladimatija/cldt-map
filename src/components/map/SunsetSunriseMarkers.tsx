'use client';

import React, { useMemo } from 'react';
import { Marker, Tooltip } from 'react-leaflet';
import { useTranslations } from 'next-intl';
import L from 'leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { usePackAdjustedPaceKmh, useTrailSunWeather } from '@/hooks';
import { findNearestPointIndex, projectPositionAtTime, type ProjectedPosition } from '@/lib/distance-utils';
import { isoLocalToUtcMs } from '@/lib/weather';
import { formatDistance, formatElevation } from '@/lib/utils';

const createSunDivIcon = (color: string): L.DivIcon =>
	L.divIcon({
		className: '',
		html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2px solid var(--marker-on-color);box-shadow:var(--trail-marker-shadow);"></div>`,
		iconSize: [18, 18],
		iconAnchor: [9, 9],
	});

const SUNSET_COLORS = { light: '#f59e0b', dark: '#fbbf24' };
const SUNRISE_COLORS = { light: '#fcd34d', dark: '#fde68a' };

/** Returns "HH:MM" from an Open-Meteo local ISO string (already in trail location's timezone). */
const formatHHMM = (isoString: string): string => isoString.slice(11, 16);

interface SunProjection {
	result: ProjectedPosition;
	point: { lat: number; lng: number };
	clamped: boolean;
	tooltipKey: 'sunset' | 'sunrise';
	timeStr: string;
	icon: L.DivIcon;
}

/**
 * Renders disc markers on the trail polyline showing where the hiker
 * will be at sunset and sunrise, based on the current position, pace, and direction.
 * Uses the same Open-Meteo daylight data as MapMarkers.
 */
export default function SunsetSunriseMarkers(): React.ReactElement | null {
	const t = useTranslations('mapControls');

	const sunsetProjection = useMapStore((state: MapStoreState) => state.sunsetProjection);
	const walkingPaceKmh = usePackAdjustedPaceKmh();
	const gradeAdjustedEta = useMapStore((state: MapStoreState) => state.gradeAdjustedEta);
	const units = useMapStore((state: MapStoreState) => state.units);
	const direction = useMapStore((state: MapStoreState) => state.direction);
	const darkMode = useMapStore((state: MapStoreState) => state.darkMode);

	const sunsetIcon = useMemo(() => createSunDivIcon(darkMode ? SUNSET_COLORS.dark : SUNSET_COLORS.light), [darkMode]);
	const sunriseIcon = useMemo(
		() => createSunDivIcon(darkMode ? SUNRISE_COLORS.dark : SUNRISE_COLORS.light),
		[darkMode],
	);

	const closestPoint = useStore((state: StoreState) => state.closestPoint);
	const enhancedTrailPoints = useStore((state: StoreState) => state.enhancedTrailPoints);

	// Daylight data + on-trail state, throttled and shared with the daylight budget chip.
	const { weatherData: effectiveWeatherData, nowMs, isOnTrail } = useTrailSunWeather(sunsetProjection);

	// Quantize the projection origin to 100 m buckets: walking 100 m moves a
	// sunset marker hours away by a negligible amount, but using the raw
	// closestPoint object re-ran the O(trail-walk) projection on every GPS
	// publish.
	const fromM100 = closestPoint ? Math.round(closestPoint.distanceFromStart / 100) : null;

	const projections = useMemo((): SunProjection[] => {
		if (!isOnTrail || !effectiveWeatherData?.sunset || enhancedTrailPoints.length < 2 || fromM100 === null) return [];

		const utcOffset = effectiveWeatherData.utcOffsetSeconds;
		const fromIndex = findNearestPointIndex(enhancedTrailPoints, fromM100 * 100);
		const lastIndex = enhancedTrailPoints.length - 1;

		const candidates: { deltaSec: number; timeStr: string; icon: L.DivIcon; tooltipKey: 'sunset' | 'sunrise' }[] = [
			{
				// isoLocalToUtcMs converts the location-local ISO string to UTC before subtracting nowMs,
				// avoiding incorrect deltaSec when the browser is in a different timezone than the trail.
				deltaSec: (isoLocalToUtcMs(effectiveWeatherData.sunset, utcOffset) - nowMs) / 1000,
				timeStr: formatHHMM(effectiveWeatherData.sunset),
				icon: sunsetIcon,
				tooltipKey: 'sunset',
			},
		];

		if (effectiveWeatherData.sunrise) {
			candidates.push({
				deltaSec: (isoLocalToUtcMs(effectiveWeatherData.sunrise, utcOffset) - nowMs) / 1000,
				timeStr: formatHHMM(effectiveWeatherData.sunrise),
				icon: sunriseIcon,
				tooltipKey: 'sunrise',
			});
		}

		const results: SunProjection[] = [];
		for (const { deltaSec, timeStr, icon, tooltipKey } of candidates) {
			if (deltaSec <= 0) continue;
			const result = projectPositionAtTime({
				fromIndex,
				deltaSec,
				direction,
				paceKmh: walkingPaceKmh,
				elevationPoints: enhancedTrailPoints,
				gradeAdjusted: gradeAdjustedEta,
			});
			if (!result) continue;
			const fallback = enhancedTrailPoints[result.index];
			// Use interpolated lat/lng from projectPositionAtTime when available (requires geoPoints in opts)
			const point = { lat: result.lat ?? fallback.lat, lng: result.lng ?? fallback.lng };
			const clamped = direction === 'SOBO' ? result.index === lastIndex : result.index === 0;
			results.push({ result, point, clamped, tooltipKey, timeStr, icon });
		}
		return results;
	}, [
		isOnTrail,
		effectiveWeatherData,
		enhancedTrailPoints,
		fromM100,
		direction,
		walkingPaceKmh,
		gradeAdjustedEta,
		nowMs,
		sunsetIcon,
		sunriseIcon,
	]);

	if (!isOnTrail || projections.length === 0) return null;

	return (
		<>
			{projections.map(({ result, point, clamped, tooltipKey, timeStr, icon }) => {
				const eventTitle = t(tooltipKey === 'sunset' ? 'sunsetTooltipTitle' : 'sunriseTooltipTitle');
				const label = clamped
					? `${eventTitle}: ${t('sunsetProjectionReachedEnd')}`
					: `${eventTitle} ${timeStr} · ${formatDistance(result.distanceM, units, 2, true)} · ${formatElevation(result.elevationM, units)} ${t('elevationUnitASL')}`;
				return (
					<Marker icon={icon} key={tooltipKey} position={[point.lat, point.lng]} zIndexOffset={-100}>
						<Tooltip className="map-tooltip map-tooltip--compact" direction="top" offset={[0, -9]}>
							{label}
						</Tooltip>
					</Marker>
				);
			})}
		</>
	);
}
