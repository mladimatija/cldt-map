'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Marker, Tooltip } from 'react-leaflet';
import { useTranslations } from 'next-intl';
import L from 'leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { TRAIL_OFF_TRAIL_THRESHOLD_M } from '@/lib/config';
import { findNearestPointIndex, projectPositionAtTime, type ProjectedPosition } from '@/lib/distance-utils';
import { fetchWeather, type WeatherData } from '@/lib/weather';
import { formatDistance, formatElevation } from '@/lib/utils';

const createSunDivIcon = (color: string): L.DivIcon =>
	L.divIcon({
		className: '',
		html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>`,
		iconSize: [18, 18],
		iconAnchor: [9, 9],
	});

const SUNSET_COLORS = { light: '#f59e0b', dark: '#fbbf24' };
const SUNRISE_COLORS = { light: '#fcd34d', dark: '#fde68a' };

/** Returns "HH:MM" from an Open-Meteo local ISO string (already in trail location's timezone). */
const formatHHMM = (isoString: string): string => isoString.slice(11, 16);

/**
 * Converts an Open-Meteo local ISO string (no timezone suffix, in the trail location's timezone)
 * to a UTC millisecond timestamp. Without this, new Date(isoString) parses in the browser's
 * local timezone - wrong outside the trail's timezone.
 */
const isoLocalToUtcMs = (isoLocal: string, utcOffsetSeconds: number): number =>
	new Date(isoLocal + 'Z').getTime() - utcOffsetSeconds * 1000;

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
	const weatherFetchedAtRef = useRef<number>(0);
	const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
	// accurate to within the 30s weather-throttle window, which is fine for hour-scale projections.
	const [nowMs, setNowMs] = useState(() => Date.now());

	const sunsetProjection = useMapStore((state: MapStoreState) => state.sunsetProjection);
	const userLocation = useMapStore((state: MapStoreState) => state.userLocation);
	const walkingPaceKmh = useMapStore((state: MapStoreState) => state.walkingPaceKmh);
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

	const isOnTrail =
		sunsetProjection && !!closestPoint && closestPoint.distance <= TRAIL_OFF_TRAIL_THRESHOLD_M && !!userLocation;

	// Fetch weather when on-trail; throttle to once per 30 s.
	useEffect(() => {
		if (!isOnTrail || !userLocation) {
			weatherFetchedAtRef.current = 0;
			return;
		}
		if (Date.now() - weatherFetchedAtRef.current < 30_000) return;
		weatherFetchedAtRef.current = Date.now();
		void fetchWeather(userLocation.lat, userLocation.lng).then((data) => {
			setNowMs(Date.now());
			setWeatherData(data);
		});
	}, [isOnTrail, userLocation]);

	// Derive effective weather: null when off-trail
	const effectiveWeatherData: WeatherData | null = isOnTrail ? weatherData : null;

	const projections = useMemo((): SunProjection[] => {
		if (!isOnTrail || !effectiveWeatherData?.sunset || enhancedTrailPoints.length < 2 || !closestPoint) return [];

		const utcOffset = effectiveWeatherData.utcOffsetSeconds;
		const fromIndex = findNearestPointIndex(enhancedTrailPoints, closestPoint.distanceFromStart);
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
		closestPoint,
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
