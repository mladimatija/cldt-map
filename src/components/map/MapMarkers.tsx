'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Marker, useMap } from 'react-leaflet';
import { useTranslations } from 'next-intl';
import L from 'leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { isWithinMapBoundary, getNavigateToPointUrl, formatDistance, formatElevation } from '@/lib/utils';
import { TRAIL_OFF_TRAIL_THRESHOLD_M } from '@/lib/config';
import { computeDistanceRemaining } from '@/lib/distance-utils';
import {
	fetchWeather,
	formatTemperature,
	formatWindSpeed,
	formatSunTime,
	weatherCodeToKey,
	weatherKeyToIcon,
	type WeatherData,
} from '@/lib/weather';
import { TrailTooltipContent, type TrailTooltipData, type TrailTooltipWeather } from './TrailTooltipContent';

/** @see TRAIL_OFF_TRAIL_THRESHOLD_M in src/lib/config.ts */
const OFF_TRAIL_DISTANCE_M = TRAIL_OFF_TRAIL_THRESHOLD_M;

/**
 * User location marker and optional "off trail" tooltip with the "navigate-to-trail" link.
 * Hides marker when outside Croatia or permission is denied.
 */
export default function MapMarkers(): React.ReactElement | null {
	const t = useTranslations('mapMarkers');
	const tRoute = useTranslations('trailRoute');
	const tWeather = useTranslations('weather');
	const tOverlay = useTranslations('distanceOverlay');
	const map = useMap();
	const userMarkerRef = useRef<L.Marker | null>(null);
	const tooltipRootRef = useRef<Root | null>(null);
	const weatherFetchedAtRef = useRef<number>(0);
	const [markerReady, setMarkerReady] = useState(false);
	const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
	const [isWeatherLoading, setIsWeatherLoading] = useState(false);

	/** Defer "unmount" so we never unmount a root while React is rendering (avoids "synchronously unmount" error). */
	const safeUnmountTooltipRoot = useCallback((): void => {
		const root = tooltipRootRef.current;
		tooltipRootRef.current = null;
		if (root) {
			queueMicrotask(() => {
				try {
					root.unmount();
				} catch {
					// ignore if already unmounted
				}
			});
		}
	}, []);
	const [isOffTrailTooltipOpen, setIsOffTrailTooltipOpen] = useState(true);
	const [isOnTrailTooltipDismissed, setIsOnTrailTooltipDismissed] = useState(false);

	// User location state from store
	const userLocation = useMapStore((state: MapStoreState) => state.userLocation);
	const isLocating = useMapStore((state: MapStoreState) => state.isLocating);
	const showUserMarker = useMapStore((state: MapStoreState) => state.showUserMarker);
	const permissionStatus = useMapStore((state: MapStoreState) => state.permissionStatus);
	const rulerRange = useMapStore((state: MapStoreState) => state.rulerRange);
	const units = useMapStore((state: MapStoreState) => state.units);
	const distancePrecision = useMapStore((state: MapStoreState) => state.distancePrecision);
	const closestPoint = useStore((state: StoreState) => state.closestPoint);
	const gpxLoaded = useStore((state: StoreState) => state.gpxLoaded);
	const enhancedTrailPoints = useStore((state: StoreState) => state.enhancedTrailPoints);
	const trailMetadata = useStore((state: StoreState) => state.trailMetadata);
	const withinMapBoundary = userLocation ? isWithinMapBoundary(userLocation.lat, userLocation.lng) : true;
	const shouldShowLocation = userLocation && showUserMarker && permissionStatus === 'granted' && withinMapBoundary;

	/** Off trail: no trail data, or known distance > threshold. When closestPoint is null but GPX is loaded,
	 * treat as off trail, so we show the tooltip (close/navigate).
	 */
	const isOffTrail =
		!gpxLoaded ||
		!userLocation ||
		permissionStatus !== 'granted' ||
		!withinMapBoundary ||
		closestPoint === null ||
		closestPoint.distance > OFF_TRAIL_DISTANCE_M;

	/** True, when we can actually navigate: trail loaded, the closest point known, and user is far from trail. */
	const canNavigateToTrail =
		gpxLoaded && userLocation && closestPoint !== null && closestPoint.distance > OFF_TRAIL_DISTANCE_M;

	/** Show close and navigate actions only when we're confidently off trail. When "closestPoint" is null (calculating) or
	 * on trail, show simple to avoid content flicker when zooming. */
	const showOffTrailActions = canNavigateToTrail && isOffTrailTooltipOpen;

	// When the user becomes off trail, show the tooltip by default and reset the "on-trail" dismissed state.
	useEffect(() => {
		if (isOffTrail) {
			setIsOffTrailTooltipOpen(true);
			setIsOnTrailTooltipDismissed(false);
		}
	}, [isOffTrail]);

	const handleMarkerClick = useCallback((): void => {
		if (isOffTrail) {
			setIsOffTrailTooltipOpen(true);
		} else {
			setIsOnTrailTooltipDismissed(false);
		}
	}, [isOffTrail]);

	const handleTooltipClose = useCallback((): void => {
		if (isOffTrail) {
			setIsOffTrailTooltipOpen(false);
		} else {
			setIsOnTrailTooltipDismissed(true);
		}
	}, [isOffTrail]);

	const setMarkerRef = useCallback((marker: L.Marker | null): void => {
		userMarkerRef.current = marker;
		setMarkerReady(!!marker);
	}, []);

	const userIcon = useMemo(
		() =>
			L.divIcon({
				className: 'user-location-marker',
				html: '<div class="user-location-dot" />',
				iconSize: [20, 20],
				iconAnchor: [10, 10],
			}),
		[],
	);

	const trailData = useMemo((): TrailTooltipData | null => {
		if (!closestPoint || closestPoint.distance > OFF_TRAIL_DISTANCE_M || enhancedTrailPoints.length === 0) return null;
		const distanceResult = computeDistanceRemaining(closestPoint, rulerRange, OFF_TRAIL_DISTANCE_M);
		if (!distanceResult) return null;

		const target = closestPoint.distanceFromStart;
		let best = enhancedTrailPoints[0];
		let bestDiff = Math.abs(best.distanceFromStart - target);
		for (let i = 1; i < enhancedTrailPoints.length; i++) {
			const diff = Math.abs(enhancedTrailPoints[i].distanceFromStart - target);
			if (diff < bestDiff) {
				bestDiff = diff;
				best = enhancedTrailPoints[i];
			}
		}

		const totalDistanceM = (trailMetadata?.totalDistance ?? 0) * 1000;
		const totalGain = trailMetadata?.elevationGain ?? 0;
		const totalLoss = trailMetadata?.elevationLoss ?? 0;
		const distanceFromStartPct =
			totalDistanceM > 0 ? ((closestPoint.distanceFromStart / totalDistanceM) * 100).toFixed(1) : '0.0';
		const distanceToEndPct =
			totalDistanceM > 0 ? ((closestPoint.distanceToEnd / totalDistanceM) * 100).toFixed(1) : '0.0';
		const gainPct =
			totalGain > 0 && best.elevationGainFromStart > 0
				? ((best.elevationGainFromStart / totalGain) * 100).toFixed(1)
				: null;
		const lossPct =
			totalLoss > 0 && best.elevationLossFromStart > 0
				? ((best.elevationLossFromStart / totalLoss) * 100).toFixed(1)
				: null;

		return {
			lat: best.lat,
			lng: best.lng,
			sectionLabel: best.sectionName ? tRoute(best.sectionName) : null,
			elevation: formatElevation(best.elevation, units),
			distanceFromStart: formatDistance(distanceResult.traveled, units, distancePrecision, true),
			distanceFromStartPct,
			distanceToEnd: formatDistance(distanceResult.toTrailEnd, units, distancePrecision, true),
			distanceToEndPct,
			distanceToSection:
				distanceResult.toSectionEnd !== null
					? formatDistance(distanceResult.toSectionEnd, units, distancePrecision, true)
					: null,
			accumulatedGain: best.elevationGainFromStart > 0 ? formatElevation(best.elevationGainFromStart, units) : null,
			accumulatedGainPct: gainPct,
			accumulatedLoss: best.elevationLossFromStart > 0 ? formatElevation(best.elevationLossFromStart, units) : null,
			accumulatedLossPct: lossPct,
		};
	}, [closestPoint, rulerRange, enhancedTrailPoints, trailMetadata, units, distancePrecision, tRoute]);

	const tooltipWeather = useMemo((): TrailTooltipWeather | null => {
		if (!weatherData) return null;
		const key = weatherCodeToKey(weatherData.weatherCode);
		return {
			icon: weatherKeyToIcon(key),
			condition: tWeather(key),
			temperature: formatTemperature(weatherData.temperatureC, units),
			feelsLike: formatTemperature(weatherData.feelsLikeC, units),
			precipitation: `${weatherData.precipitationProbabilityPct}%`,
			wind: formatWindSpeed(weatherData.windspeedKmh, units),
			sunrise: formatSunTime(weatherData.sunrise, units),
			sunset: formatSunTime(weatherData.sunset, units),
		};
	}, [weatherData, units, tWeather]);

	// Fetch weather for the user's location when on-trail; re-fetches after 30 s minimum.
	useEffect(() => {
		if (!userLocation || isOffTrail) {
			setWeatherData(null);
			setIsWeatherLoading(false);
			weatherFetchedAtRef.current = 0;
			return;
		}
		if (Date.now() - weatherFetchedAtRef.current < 30_000) return;
		weatherFetchedAtRef.current = Date.now();
		setIsWeatherLoading(true);
		void fetchWeather(userLocation.lat, userLocation.lng).then((data) => {
			setWeatherData(data);
			setIsWeatherLoading(false);
		});
	}, [userLocation, isOffTrail]);

	// Update marker when the user location changes
	useEffect(() => {
		if (!userLocation || !withinMapBoundary || permissionStatus !== 'granted') {
			return;
		}
		if (isLocating) {
			map.setView([userLocation.lat, userLocation.lng], 14);
		}
	}, [userLocation, isLocating, map, withinMapBoundary, permissionStatus]);

	const showTooltip = (isOffTrail && isOffTrailTooltipOpen) || (!isOffTrail && !isOnTrailTooltipDismissed);

	const renderTooltipContent = useCallback(() => {
		const root = tooltipRootRef.current;
		if (!root) return;
		root.render(
			<TrailTooltipContent
				showClose
				canNavigate={!!canNavigateToTrail && !!showOffTrailActions}
				labels={{
					close: tRoute('close'),
					coordinates: tRoute('tooltipCoordinates'),
					section: tRoute('tooltipSection'),
					elevation: tRoute('tooltipElevation'),
					distanceFromStart: `${tOverlay('traveled')}:`,
					distanceToEnd: `${tOverlay('toTrailEnd')}:`,
					distanceToSection: `${tOverlay('toSectionEnd')}:`,
					accumulatedGain: tRoute('tooltipAccumulatedGain'),
					accumulatedLoss: tRoute('tooltipAccumulatedLoss'),
					temperature: `${tWeather('temperature')}:`,
					feelsLike: `${tWeather('feelsLike')}:`,
					precipitation: `${tWeather('precipitation')}:`,
					wind: `${tWeather('wind')}:`,
					sunrise: `${tWeather('sunrise')}:`,
					sunset: `${tWeather('sunset')}`,
					weatherLoading: tWeather('loading'),
					navigate: t('navigateToTrail'),
				}}
				title={t('yourLocation')}
				trailData={trailData}
				weather={tooltipWeather}
				weatherLoading={isWeatherLoading}
				onClose={handleTooltipClose}
				onNavigate={() => {
					const loc = useMapStore.getState().userLocation;
					const forceCalc = useStore.getState().forceCalculateClosestPointFromLocation;
					if (loc && forceCalc) {
						forceCalc(loc);
						const cp = useStore.getState().closestPoint;
						if (cp) {
							const url = getNavigateToPointUrl(loc.lat, loc.lng, cp.point.lat, cp.point.lng);
							window.open(url, '_blank', 'noopener,noreferrer');
						}
						setIsOffTrailTooltipOpen(false);
					}
				}}
			/>,
		);
	}, [
		canNavigateToTrail,
		showOffTrailActions,
		tRoute,
		tOverlay,
		tWeather,
		t,
		trailData,
		tooltipWeather,
		isWeatherLoading,
		handleTooltipClose,
	]);

	// Bind/unbind tooltip when visibility changes. Use a single React container, so we never switch content types.
	useEffect(() => {
		const marker = userMarkerRef.current;
		if (!shouldShowLocation || !userLocation || !marker || !markerReady) {
			if (marker) {
				safeUnmountTooltipRoot();
				const existing = marker.getTooltip();
				if (existing) {
					marker.closeTooltip();
					marker.unbindTooltip();
				}
			}
			return;
		}

		if (!showTooltip) {
			safeUnmountTooltipRoot();
			const existing = marker.getTooltip();
			if (existing) {
				marker.closeTooltip();
				marker.unbindTooltip();
			}
			return;
		}

		const container = document.createElement('div');
		tooltipRootRef.current = createRoot(container);
		renderTooltipContent();

		marker.bindTooltip(container, {
			offset: L.point(0, -15),
			direction: 'top',
			permanent: true,
			className: 'map-tooltip map-tooltip--wide',
		});
		marker.openTooltip();

		const tooltip = marker.getTooltip();
		const el = tooltip?.getElement();
		if (el) {
			L.DomEvent.disableClickPropagation(el);
			L.DomEvent.disableScrollPropagation(el);
		}

		return () => {
			safeUnmountTooltipRoot();
			marker.closeTooltip();
			marker.unbindTooltip();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- renderTooltipContent called for initial render; update effect handles subsequent updates
	}, [markerReady, safeUnmountTooltipRoot, shouldShowLocation, showTooltip, userLocation]);

	// Update tooltip content when state changes, without unbinding (avoids flicker).
	useEffect(() => {
		if (showTooltip && tooltipRootRef.current) {
			renderTooltipContent();
		}
	}, [showTooltip, renderTooltipContent]);

	if (!shouldShowLocation) {
		return null;
	}

	return (
		<Marker
			eventHandlers={{
				click: handleMarkerClick,
			}}
			icon={userIcon}
			position={[userLocation.lat, userLocation.lng]}
			ref={setMarkerRef}
		/>
	);
}
