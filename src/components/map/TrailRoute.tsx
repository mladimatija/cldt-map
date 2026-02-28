'use client';

/**
 * Renders the CLDT trail polyline, start/finish markers, and trail info tooltip on map click or share URL.
 * Fetches GPX, builds enhanced points (distance/elevation), and syncs with the main store and map store.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { useFitToRoute } from '@/components/map/useFitToRoute';
import {
	DEFAULT_PATH_OPTIONS,
	TRAIL_EPSILON_M,
	TOOLTIP_EST_WIDTH,
	TOOLTIP_EST_HEIGHT,
	TOOLTIP_PADDING,
	START_FLAG_SVG,
	FINISH_FLAG_SVG,
} from '@/components/map/trail-route-constants';
import { fetchGPXWithCache } from '@/lib/gpx-cache';
import { calculateTrailMetadata } from '@/lib/map';
import { clearShareUrlParams, formatDistance, formatElevation, parseShareUrlParams } from '@/lib/utils';
import { useTranslations } from 'next-intl';

interface TrailRouteProps {
	pathOptions?: L.PathOptions;
}

export default function TrailRoute({ pathOptions = DEFAULT_PATH_OPTIONS }: TrailRouteProps): React.ReactElement | null {
	const t = useTranslations('trailRoute');
	const tChart = useTranslations('elevationChart');
	const map = useMap();
	const routeLayerRef = useRef<L.Polyline | null>(null);
	const markerRef = useRef<L.Marker | null>(null);
	const tooltipRef = useRef<L.Tooltip | null>(null);
	const startMarkerRef = useRef<L.Marker | null>(null);
	const finishMarkerRef = useRef<L.Marker | null>(null);
	const [isTooltipVisible, setIsTooltipVisible] = useState(false);
	const showMarkerAtPositionRef = useRef<(point: TrailPoint) => void>(() => {});
	const clearMarkerAndTooltipRef = useRef<() => void>(() => {});
	const isTooltipPinnedByClickRef = useRef(false);
	const lastRouteClickTimeRef = useRef(0);
	const mapClickHandlerRef = useRef<(() => void) | null>(null);

	useFitToRoute(map, routeLayerRef);

	const selectedTrail = useMapStore((state: MapStoreState) => state.selectedTrail);
	const direction = useMapStore((state: MapStoreState) => state.direction);
	const units = useMapStore((state: MapStoreState) => state.units);
	const isRulerEnabled = useMapStore((state: MapStoreState) => state.isRulerEnabled);
	const distancePrecision = useMapStore((state: MapStoreState) => state.distancePrecision);

	const highlightedPoint = useStore((state: StoreState) => state.highlightedTrailPoint);
	const tooltipPinnedFromShare = useStore((state: StoreState) => state.tooltipPinnedFromShare);
	const highlightTrailPosition = useStore((state: StoreState) => state.highlightTrailPosition);
	const clearTrailHighlight = useStore((state: StoreState) => state.clearTrailHighlight);
	const trailMetadata = useStore((state: StoreState) => state.trailMetadata);

	const setRawGpxData = useMapStore((state: MapStoreState) => state.setRawGpxData);
	const setGpxElevationPoints = useMapStore((state: MapStoreState) => state.setGpxElevationPoints);
	const setGpxLoaded = useMapStore((state: MapStoreState) => state.setGpxLoaded);
	const setGpxLoadFailed = useMapStore((state: MapStoreState) => state.setGpxLoadFailed);
	const processTrailData = useMapStore((state: MapStoreState) => state.processTrailData);

	interface TrailPoint {
		lat: number;
		lng: number;
		elevation?: number;
		distanceFromStart?: number;
		elevationGainFromStart?: number;
		elevationLossFromStart?: number;
	}

	const clearMarkerAndTooltip = useCallback((): void => {
		if (markerRef.current && map) {
			markerRef.current.removeFrom(map);
			markerRef.current = null;
		}
		if (tooltipRef.current && map) {
			tooltipRef.current.removeFrom(map);
			tooltipRef.current = null;
		}
	}, [map]);

	const removeRouteAndMarkersFromMap = useCallback((): void => {
		if (!map) return;
		if (routeLayerRef.current) {
			routeLayerRef.current.removeFrom(map);
			routeLayerRef.current = null;
		}
		if (startMarkerRef.current) {
			startMarkerRef.current.removeFrom(map);
			startMarkerRef.current = null;
		}
		if (finishMarkerRef.current) {
			finishMarkerRef.current.removeFrom(map);
			finishMarkerRef.current = null;
		}
	}, [map]);

	const showMarkerAtPosition = useCallback(
		(point: TrailPoint): void => {
			if (!map) {
				return;
			}
			const currentUnits = useMapStore.getState().units;
			const currentPrecision = useMapStore.getState().distancePrecision;

			if (markerRef.current) {
				markerRef.current.removeFrom(map);
				markerRef.current = null;
			}

			const markerPosition = L.latLng(point.lat, point.lng);
			const marker = L.marker(markerPosition, {
				icon: L.divIcon({
					className: 'trail-highlight-marker',
					html: '<div class="pulse-marker"></div>',
					iconSize: [14, 14],
					iconAnchor: [7, 7],
				}),
			});

			marker.addTo(map);
			markerRef.current = marker;

			if (tooltipRef.current) {
				tooltipRef.current.removeFrom(map);
				tooltipRef.current = null;
			}

			const metadata = useStore.getState().trailMetadata;
			const totalDistanceKm = metadata?.totalDistance ?? 0;
			const totalElevationGain = metadata?.elevationGain ?? 0;
			const totalElevationLoss = metadata?.elevationLoss ?? 0;
			const totalDistanceM = totalDistanceKm * 1000;

			let distanceFromStart = point.distanceFromStart ?? 0;
			let distanceToEnd = Math.max(0, totalDistanceM - distanceFromStart);
			let elevationGainFromStart = point.elevationGainFromStart ?? 0;
			let elevationLossFromStart = point.elevationLossFromStart ?? 0;

			if (distanceFromStart < TRAIL_EPSILON_M) {
				distanceFromStart = 0;
				distanceToEnd = totalDistanceM;
				elevationGainFromStart = 0;
				elevationLossFromStart = 0;
			} else if (distanceToEnd < TRAIL_EPSILON_M) {
				distanceFromStart = totalDistanceM;
				distanceToEnd = 0;
				elevationGainFromStart = totalElevationGain;
				elevationLossFromStart = totalElevationLoss;
			}

			const currentElevation = point.elevation ?? 0;
			const distanceFromStartPct = totalDistanceM > 0 ? (distanceFromStart / totalDistanceM) * 100 : 0;
			const distanceToEndPct = totalDistanceM > 0 ? (distanceToEnd / totalDistanceM) * 100 : 0;
			const accumulatedGainPct = totalElevationGain > 0 ? (elevationGainFromStart / totalElevationGain) * 100 : 0;
			const accumulatedLossPct = totalElevationLoss > 0 ? (elevationLossFromStart / totalElevationLoss) * 100 : 0;

			const lat = point.lat;
			const lng = point.lng;
			const coordsFormatted = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
			const trailInfoHtml = `
        <p><span class="font-bold">${t('tooltipCoordinates')}</span> <span class="trail-tooltip-coords-link font-bold" data-lat="${lat}" data-lng="${lng}" role="button" tabindex="0">${coordsFormatted}</span></p>
        <p><span class="font-medium">${t('tooltipElevation')}</span> ${formatElevation(currentElevation, currentUnits)}</p>
        <p><span class="font-medium">${t('tooltipDistanceFromStart')}</span> ${formatDistance(distanceFromStart, currentUnits, currentPrecision, true)} (${distanceFromStartPct.toFixed(1)}%)</p>
        <p><span class="font-medium">${t('tooltipDistanceToEnd')}</span> ${formatDistance(distanceToEnd, currentUnits, currentPrecision, true)} (${distanceToEndPct.toFixed(1)}%)</p>
        <p><span class="font-medium">${t('tooltipAccumulatedGain')}</span> ${formatElevation(elevationGainFromStart, currentUnits)} (${accumulatedGainPct.toFixed(1)}%)</p>
        <p><span class="font-medium">${t('tooltipAccumulatedLoss')}</span> ${formatElevation(elevationLossFromStart, currentUnits)} (${accumulatedLossPct.toFixed(1)}%)</p>
        <p class="border-t border-black mt-1 pt-1"><span class="font-medium">${t('tooltipTotalDistance')}</span> ${formatDistance(totalDistanceKm, currentUnits, currentPrecision)}</p>
        <p><span class="font-medium">${t('tooltipTotalGain')}</span> ${formatElevation(totalElevationGain, currentUnits)}</p>
        <p><span class="font-medium">${t('tooltipTotalLoss')}</span> ${formatElevation(totalElevationLoss, currentUnits)}</p>
      `;
			const tooltipContent = `
      <div class="user-location-tooltip-inner">
        <button aria-label="${t('tooltipClose')}" class="user-location-close-btn" type="button">×</button>
        <div class="text-sm text-left">${trailInfoHtml}</div>
      </div>
    `;

			const mapContainer = map.getContainer();
			const containerSize = map.getSize();
			const markerPoint = map.latLngToContainerPoint(markerPosition);
			const spaceTop = markerPoint.y;
			const spaceBottom = containerSize.y - markerPoint.y;
			const spaceLeft = markerPoint.x;
			const spaceRight = containerSize.x - markerPoint.x;
			const dir =
				spaceTop >= TOOLTIP_EST_HEIGHT + TOOLTIP_PADDING
					? 'top'
					: spaceBottom >= TOOLTIP_EST_HEIGHT + TOOLTIP_PADDING
						? 'bottom'
						: spaceRight >= TOOLTIP_EST_WIDTH + TOOLTIP_PADDING
							? 'right'
							: spaceLeft >= TOOLTIP_EST_WIDTH + TOOLTIP_PADDING
								? 'left'
								: 'top';
			const offset =
				dir === 'top'
					? L.point(0, -20)
					: dir === 'bottom'
						? L.point(0, 20)
						: dir === 'left'
							? L.point(-20, 0)
							: L.point(20, 0);

			const tooltip = L.tooltip({
				offset,
				direction: dir,
				permanent: isTooltipVisible || tooltipPinnedFromShare,
				className: 'trail-tooltip-container',
			})
				.setLatLng(markerPosition)
				.setContent(tooltipContent)
				.addTo(map);

			const el = tooltip.getElement();
			if (el) {
				el.addEventListener('click', (e: MouseEvent) => {
					const closeBtn = (e.target as HTMLElement).closest('.user-location-close-btn');
					if (closeBtn) {
						e.preventDefault();
						e.stopPropagation();
						clearTrailHighlight?.(true);
						clearShareUrlParams();
						return;
					}
					const link = (e.target as HTMLElement).closest('.trail-tooltip-coords-link');
					if (!link) {
						return;
					}
					e.preventDefault();
					e.stopPropagation();
					const linkEl = link as HTMLElement;
					const linkLat = linkEl.dataset.lat;
					const linkLng = linkEl.dataset.lng;
					if (linkLat === undefined || linkLng === undefined) {
						return;
					}
					const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
					if (isMobile) {
						window.location.href = `geo:${linkLat},${linkLng}`;
					} else {
						window.open(`https://www.google.com/maps?q=${linkLat},${linkLng}`, '_blank', 'noopener,noreferrer');
					}
				});

				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						const rect = el.getBoundingClientRect();
						const mapRect = mapContainer.getBoundingClientRect();
						const style = el.style;
						let dx = 0;
						let dy = 0;
						if (rect.left < mapRect.left + TOOLTIP_PADDING) {
							dx = mapRect.left + TOOLTIP_PADDING - rect.left;
						} else if (rect.right > mapRect.right - TOOLTIP_PADDING) {
							dx = mapRect.right - TOOLTIP_PADDING - rect.right;
						}
						if (rect.top < mapRect.top + TOOLTIP_PADDING) {
							dy = mapRect.top + TOOLTIP_PADDING - rect.top;
						} else if (rect.bottom > mapRect.bottom - TOOLTIP_PADDING) {
							dy = mapRect.bottom - TOOLTIP_PADDING - rect.bottom;
						}
						if (dx !== 0 || dy !== 0) {
							const current = style.transform || '';
							style.transform = current ? `${current} translate(${dx}px, ${dy}px)` : `translate(${dx}px, ${dy}px)`;
						}
					});
				});
			}

			tooltipRef.current = tooltip;
		},
		[map, isTooltipVisible, tooltipPinnedFromShare, clearTrailHighlight, t],
	);

	useEffect(() => {
		showMarkerAtPositionRef.current = showMarkerAtPosition;
		clearMarkerAndTooltipRef.current = clearMarkerAndTooltip;
	}, [showMarkerAtPosition, clearMarkerAndTooltip]);

	useEffect(() => {
		if (isRulerEnabled) {
			isTooltipPinnedByClickRef.current = false;
			clearMarkerAndTooltip();
			if (clearTrailHighlight) {
				clearTrailHighlight(true);
			}
		}
	}, [isRulerEnabled, clearMarkerAndTooltip, clearTrailHighlight]);

	useEffect(() => {
		if (!map) {
			return;
		}

		let isMounted = true;
		removeRouteAndMarkersFromMap();

		const loadGpxData = async (): Promise<void> => {
			try {
				const result = await fetchGPXWithCache();

				if (!isMounted) {
					return;
				}

				if (result.status === 'error') {
					console.error('Failed to load GPX data:', result.message);
					if (setGpxLoadFailed) {
						setGpxLoadFailed(true);
					}
					return;
				}

				const parser = new DOMParser();
				const gpxDoc = parser.parseFromString(result.data, 'text/xml');

				if (setRawGpxData) {
					setRawGpxData(result.data);
				}

				const trackpoints = gpxDoc.getElementsByTagName('trkpt');
				const points: L.LatLngExpression[] = [];
				const elevationPoints: { lat: number; lng: number; elevation: number }[] = [];

				for (let i = 0; i < trackpoints.length; i++) {
					const point = trackpoints[i];
					const lat = parseFloat(point.getAttribute('lat') || '0');
					const lng = parseFloat(point.getAttribute('lon') || '0');

					if (lat && lng) {
						points.push([lat, lng] as L.LatLngTuple);

						const elevNode = point.getElementsByTagName('ele')[0];
						const elevation = elevNode ? parseFloat(elevNode.textContent || '0') : 0;

						elevationPoints.push({
							lat,
							lng,
							elevation,
						});
					}
				}

				const directionAdjustedPoints = direction === 'NOBO' ? [...points].reverse() : points;
				const directionAdjustedElevPoints = direction === 'NOBO' ? [...elevationPoints].reverse() : elevationPoints;

				if (points.length > 0) {
					const polyline = L.polyline(directionAdjustedPoints, {
						...pathOptions,
						smoothFactor: 1,
						interactive: true,
						bubblingMouseEvents: true,
						weight: pathOptions.weight || 5,
						renderer: L.svg({ padding: 10 }),
					});

					polyline.on('mousemove', (e) => {
						if (useMapStore.getState().isRulerEnabled) {
							return;
						}
						if (useStore.getState().tooltipPinnedFromShare) {
							return;
						}
						if (highlightTrailPosition) {
							highlightTrailPosition({
								lat: e.latlng.lat,
								lng: e.latlng.lng,
							});
						}
					});

					polyline.on('mouseout', () => {
						if (isTooltipPinnedByClickRef.current) {
							return;
						}
						if (useStore.getState().tooltipPinnedFromShare) {
							return;
						}
						if (clearTrailHighlight) {
							clearTrailHighlight();
						}
					});

					polyline.on('click', (e) => {
						if (useMapStore.getState().isRulerEnabled) {
							return;
						}
						lastRouteClickTimeRef.current = Date.now();
						isTooltipPinnedByClickRef.current = true;
						if (useStore.getState().tooltipPinnedFromShare) {
							useStore.getState().setTooltipPinnedFromShare?.(false);
							clearShareUrlParams();
						}
						if (highlightTrailPosition) {
							highlightTrailPosition({
								lat: e.latlng.lat,
								lng: e.latlng.lng,
							});
							setIsTooltipVisible(true);
						}
					});

					const handleMapClick = (): void => {
						if (Date.now() - lastRouteClickTimeRef.current < 100) {
							return;
						}
						if (useStore.getState().tooltipPinnedFromShare) {
							return;
						}
						isTooltipPinnedByClickRef.current = false;
						if (clearTrailHighlight) {
							clearTrailHighlight();
						}
					};
					map.on('click', handleMapClick);
					mapClickHandlerRef.current = handleMapClick;

					polyline.addTo(map);
					routeLayerRef.current = polyline;

					const directionText = direction === 'SOBO' ? tChart('directionNorthSouth') : tChart('directionSouthNorth');
					const startPoint = L.latLng(
						(directionAdjustedPoints[0] as L.LatLngTuple)[0],
						(directionAdjustedPoints[0] as L.LatLngTuple)[1],
					);
					const finishPoint = L.latLng(
						(directionAdjustedPoints[directionAdjustedPoints.length - 1] as L.LatLngTuple)[0],
						(directionAdjustedPoints[directionAdjustedPoints.length - 1] as L.LatLngTuple)[1],
					);

					const startIcon = L.divIcon({
						className: 'trail-endpoint-marker trail-start-marker',
						html: `<div class="trail-endpoint-marker-inner">${START_FLAG_SVG}</div>`,
						iconSize: [28, 28],
						iconAnchor: [14, 14],
					});
					const startMarker = L.marker(startPoint, {
						icon: startIcon,
						zIndexOffset: 100,
					});
					startMarker.bindTooltip(t('startingPoint', { direction: directionText }), {
						direction: 'top',
						permanent: false,
						className: 'trail-endpoint-tooltip',
					});
					const startLabel = t('startingPoint', { direction: directionText });
					startMarker.on('add', () => {
						const el =
							(startMarker as L.Marker & { getElement?: () => HTMLElement }).getElement?.() ??
							(startMarker as unknown as { _icon?: HTMLElement })._icon;
						if (el) el.setAttribute('aria-label', startLabel);
					});
					startMarker.addTo(map);
					startMarkerRef.current = startMarker;

					const finishIcon = L.divIcon({
						className: 'trail-endpoint-marker trail-finish-marker',
						html: `<div class="trail-endpoint-marker-inner">${FINISH_FLAG_SVG}</div>`,
						iconSize: [28, 28],
						iconAnchor: [14, 14],
					});
					const finishMarker = L.marker(finishPoint, {
						icon: finishIcon,
						zIndexOffset: 100,
					});
					finishMarker.bindTooltip(t('finishPoint', { direction: directionText }), {
						direction: 'top',
						permanent: false,
						className: 'trail-endpoint-tooltip',
					});
					const finishLabel = t('finishPoint', { direction: directionText });
					finishMarker.on('add', () => {
						const el =
							(finishMarker as L.Marker & { getElement?: () => HTMLElement }).getElement?.() ??
							(finishMarker as unknown as { _icon?: HTMLElement })._icon;
						if (el) el.setAttribute('aria-label', finishLabel);
					});
					finishMarker.addTo(map);
					finishMarkerRef.current = finishMarker;

					const shareParams = parseShareUrlParams();
					if (!shareParams?.progress) {
						map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
					}

					if (processTrailData) {
						const latLngs = polyline.getLatLngs() as L.LatLng[];
						const metadata = calculateTrailMetadata(latLngs, directionAdjustedElevPoints);

						processTrailData(
							latLngs,
							directionAdjustedElevPoints,
							metadata.startPoint,
							metadata.endPoint,
							metadata.totalDistance / 1000, // convert to km
							metadata.elevationGain,
							metadata.elevationLoss,
						);

						const storeProcessTrailData = useStore.getState().processTrailData;
						if (storeProcessTrailData) {
							storeProcessTrailData(
								latLngs,
								directionAdjustedElevPoints,
								metadata.startPoint,
								metadata.endPoint,
								metadata.totalDistance / 1000,
								metadata.elevationGain,
								metadata.elevationLoss,
							);
						}
					}

					if (setGpxLoaded) {
						setGpxLoaded(true);
					}
				}
			} catch (error) {
				console.error('Error loading GPX trail:', error);
				if (setGpxLoadFailed) {
					setGpxLoadFailed(true);
				}
			}
		};

		void loadGpxData();

		const handlePositionHighlighted = (e: CustomEvent): void => {
			if (useStore.getState().tooltipPinnedFromShare) return;
			if (e.detail.point) {
				showMarkerAtPositionRef.current(e.detail.point);
			}
		};

		const handleHighlightCleared = (): void => {
			isTooltipPinnedByClickRef.current = false;
			clearMarkerAndTooltipRef.current();
			setIsTooltipVisible(false);
		};

		window.addEventListener('trailPositionHighlighted', handlePositionHighlighted as EventListener);
		window.addEventListener('trailHighlightCleared', handleHighlightCleared);

		return () => {
			isMounted = false;
			window.removeEventListener('trailPositionHighlighted', handlePositionHighlighted as EventListener);
			window.removeEventListener('trailHighlightCleared', handleHighlightCleared);
			if (mapClickHandlerRef.current) {
				map.off('click', mapClickHandlerRef.current);
				mapClickHandlerRef.current = null;
			}
			removeRouteAndMarkersFromMap();
			clearMarkerAndTooltipRef.current();
		};
	}, [
		map,
		removeRouteAndMarkersFromMap,
		pathOptions,
		selectedTrail,
		direction,
		t,
		tChart,
		setRawGpxData,
		setGpxElevationPoints,
		setGpxLoaded,
		setGpxLoadFailed,
		processTrailData,
		highlightTrailPosition,
		clearTrailHighlight,
	]);

	useEffect(() => {
		if (isRulerEnabled) {
			if (highlightedPoint) {
				if (clearTrailHighlight) {
					clearTrailHighlight();
				}
				clearMarkerAndTooltip();
			}
			return;
		}
		if (highlightedPoint) {
			showMarkerAtPosition(highlightedPoint);
		} else if (!isTooltipVisible) {
			clearMarkerAndTooltip();
		}
	}, [
		highlightedPoint,
		isTooltipVisible,
		isRulerEnabled,
		units,
		distancePrecision,
		trailMetadata,
		showMarkerAtPosition,
		clearMarkerAndTooltip,
		clearTrailHighlight,
	]);

	useEffect(() => {
		const handleUnitsChange = (): void => {
			if (highlightedPoint) {
				showMarkerAtPosition(highlightedPoint);
			}
		};
		window.addEventListener('unitsChange', handleUnitsChange);
		return () => window.removeEventListener('unitsChange', handleUnitsChange);
	}, [highlightedPoint, units, distancePrecision, trailMetadata, showMarkerAtPosition]);

	return null;
}
