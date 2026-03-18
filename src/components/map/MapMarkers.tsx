'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Marker, useMap } from 'react-leaflet';
import { useTranslations } from 'next-intl';
import L from 'leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { isWithinMapBoundary, getNavigateToPointUrl, formatDistance } from '@/lib/utils';
import { TRAIL_OFF_TRAIL_THRESHOLD_M } from '@/lib/config';
import { computeDistanceRemaining } from '@/lib/distance-utils';
import { fetchWeather, formatTemperature, formatWindSpeed, weatherCodeToKey, type WeatherData } from '@/lib/weather';
import { Button } from '@/components/ui/Button';

/** @see TRAIL_OFF_TRAIL_THRESHOLD_M in src/lib/config.ts */
const OFF_TRAIL_DISTANCE_M = TRAIL_OFF_TRAIL_THRESHOLD_M;

interface DistanceInfo {
	traveled: string;
	toTrailEnd: string;
	toSectionEnd: string | null;
}

interface WeatherInfo {
	condition: string;
	temperature: string;
	wind: string;
	precipitation: string;
}

interface LocationTooltipContentProps {
	canNavigate: boolean;
	closeLabel: string;
	distanceInfo: DistanceInfo | null;
	distanceLabels: { traveled: string; toTrailEnd: string; toSectionEnd: string };
	navigateLabel: string;
	showClose: boolean;
	yourLocationText: string;
	weatherInfo: WeatherInfo | null;
	weatherLabels: { temperature: string; wind: string; precipitation: string };
	onClose: () => void;
	onNavigate: () => void;
}

function LocationTooltipContent({
	canNavigate,
	closeLabel,
	distanceInfo,
	distanceLabels,
	navigateLabel,
	showClose,
	yourLocationText,
	weatherInfo,
	weatherLabels,
	onClose,
	onNavigate,
}: LocationTooltipContentProps): React.ReactElement {
	return (
		<div
			className="user-location-tooltip-inner"
			role="presentation"
			onClick={(e) => e.stopPropagation()}
			onMouseDown={(e) => e.stopPropagation()}
		>
			{showClose && (
				<Button aria-label={closeLabel} className="user-location-close-btn" variant="closeIcon" onClick={onClose}>
					×
				</Button>
			)}
			<div className="font-medium">{yourLocationText}</div>
			{distanceInfo && (
				<div className="mt-1 space-y-0.5 text-xs">
					<div>
						{distanceLabels.traveled}: {distanceInfo.traveled}
					</div>
					<div>
						{distanceLabels.toTrailEnd}: {distanceInfo.toTrailEnd}
					</div>
					{distanceInfo.toSectionEnd !== null && (
						<div>
							{distanceLabels.toSectionEnd}: {distanceInfo.toSectionEnd}
						</div>
					)}
				</div>
			)}
			{weatherInfo && (
				<div className="mt-1 space-y-0.5 border-t border-black/10 pt-1">
					<div>{weatherInfo.condition}</div>
					<div>
						{weatherLabels.temperature}: {weatherInfo.temperature}
					</div>
					<div>
						{weatherLabels.wind}: {weatherInfo.wind}
					</div>
					<div>
						{weatherLabels.precipitation}: {weatherInfo.precipitation}
					</div>
				</div>
			)}
			{canNavigate && (
				<div className="mt-2 flex justify-center gap-2">
					<Button variant="mapTooltipPrimary" onClick={onNavigate}>
						{navigateLabel}
					</Button>
				</div>
			)}
		</div>
	);
}

/**
 * User location marker and optional "off trail" tooltip with the "navigate-to-trail" link.
 * Hides marker when outside Croatia or permission is denied.
 */
export default function MapMarkers(): React.ReactElement | null {
	const t = useTranslations('mapMarkers');
	const tWeather = useTranslations('weather');
	const map = useMap();
	const userMarkerRef = useRef<L.Marker | null>(null);
	const tooltipRootRef = useRef<Root | null>(null);
	const weatherFetchedAtRef = useRef<number>(0);
	const [markerReady, setMarkerReady] = useState(false);
	const [weatherData, setWeatherData] = useState<WeatherData | null>(null);

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

	const distanceInfo = useMemo((): DistanceInfo | null => {
		const result = computeDistanceRemaining(closestPoint, rulerRange, OFF_TRAIL_DISTANCE_M);
		if (!result) return null;
		return {
			traveled: formatDistance(result.traveled, units, distancePrecision, true),
			toTrailEnd: formatDistance(result.toTrailEnd, units, distancePrecision, true),
			toSectionEnd:
				result.toSectionEnd !== null ? formatDistance(result.toSectionEnd, units, distancePrecision, true) : null,
		};
	}, [closestPoint, rulerRange, units, distancePrecision]);

	const weatherInfo = useMemo((): WeatherInfo | null => {
		if (!weatherData) return null;
		return {
			condition: tWeather(weatherCodeToKey(weatherData.weatherCode)),
			temperature: formatTemperature(weatherData.temperatureC, units),
			wind: formatWindSpeed(weatherData.windspeedKmh, units),
			precipitation: `${weatherData.precipitationProbabilityPct}%`,
		};
	}, [weatherData, units, tWeather]);

	// Fetch weather for the user's location when on-trail; re-fetches after 30 s minimum.
	useEffect(() => {
		if (!userLocation || isOffTrail) {
			setWeatherData(null);
			weatherFetchedAtRef.current = 0;
			return;
		}
		if (Date.now() - weatherFetchedAtRef.current < 30_000) return;
		weatherFetchedAtRef.current = Date.now();
		void fetchWeather(userLocation.lat, userLocation.lng).then(setWeatherData);
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
			<LocationTooltipContent
				showClose
				canNavigate={!!canNavigateToTrail && !!showOffTrailActions}
				closeLabel={t('close')}
				distanceInfo={distanceInfo}
				distanceLabels={{
					traveled: t('traveled'),
					toTrailEnd: t('toTrailEnd'),
					toSectionEnd: t('toSectionEnd'),
				}}
				navigateLabel={t('navigateToTrail')}
				weatherInfo={weatherInfo}
				weatherLabels={{
					temperature: tWeather('temperature'),
					wind: tWeather('wind'),
					precipitation: tWeather('precipitation'),
				}}
				yourLocationText={t('yourLocation')}
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
	}, [canNavigateToTrail, distanceInfo, showOffTrailActions, t, tWeather, handleTooltipClose, weatherInfo]);

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
