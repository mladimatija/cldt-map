'use client';

/**
 * Renders the CLDT trail polyline, start/finish markers, and trail info tooltip on map click or share URL.
 * Fetches GPX, builds enhanced points (distance/elevation), and syncs with the main store and map store.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import {
	DEFAULT_PATH_OPTIONS,
	TRAIL_EPSILON_M,
	TOOLTIP_EST_WIDTH,
	TOOLTIP_EST_HEIGHT,
	TOOLTIP_PADDING,
	START_FLAG_SVG,
	FINISH_FLAG_SVG,
	sectionBoundaryIcon,
} from '@/components/map/trail-route-constants';
import { TRAIL_SECTIONS } from '@/lib/trail-sections';
import { fetchGPXWithCache } from '@/lib/gpx-cache';
import { calculateTrailMetadata, estimatePassageDays } from '@/lib/map';
import { clearShareUrlParams, formatDistance, formatElevation, parseShareUrlParams } from '@/lib/utils';
import type { UnitSystem } from '@/lib/types';
import { useLocale, useTranslations } from 'next-intl';
import { useFitToRoute } from '@/hooks';

interface SectionTooltipStats {
	/** Distance from current start to section start (m). */
	startDistM: number;
	/** Distance from current start to section end (m). */
	endDistM: number;
	secDistM: number;
	secAscent: number;
	secDescent: number;
	/** Geographic section index (0=A, 1=B, 2=C) for label and color. */
	sectionIndex: number;
}

function buildSectionTooltipHtml(
	stats: SectionTooltipStats,
	totals: { totalDistanceM: number; totalAscentM: number; totalDescentM: number },
	units: UnitSystem,
	precision: number,
	t: (key: string) => string,
): string {
	const { startDistM, endDistM, secDistM, secAscent, secDescent, sectionIndex } = stats;
	const section = TRAIL_SECTIONS[sectionIndex];
	const { totalDistanceM, totalAscentM, totalDescentM } = totals;
	const alongTrailStartM = section.startKm * 1000;
	const alongTrailEndM = section.endKm === Infinity ? totalDistanceM : section.endKm * 1000;
	const distPct = totalDistanceM > 0 ? ((secDistM / totalDistanceM) * 100).toFixed(1) : '0.0';
	const ascentPct = totalAscentM > 0 ? ((secAscent / totalAscentM) * 100).toFixed(1) : '0.0';
	const descentPct = totalDescentM > 0 ? ((secDescent / totalDescentM) * 100).toFixed(1) : '0.0';
	const estimatedDays = estimatePassageDays(secDistM, secAscent);
	const ofTrail = t('sectionOfTrail');
	return `
		<div class="map-tooltip__inner">
			<p class="font-bold text-sm mb-1 trail-section-title-${sectionIndex}">${t(section.nameKey)}</p>
			<p><span class="font-medium">${t('sectionAlongTrail')}</span> ${formatDistance(alongTrailStartM, units, precision, true)} – ${formatDistance(alongTrailEndM, units, precision, true)}</p>
			<p><span class="font-medium">${t('sectionFromYourStart')}</span> ${formatDistance(startDistM, units, precision, true)} – ${formatDistance(endDistM, units, precision, true)}</p>
			<p><span class="font-medium">${t('sectionDistance')}</span> ${formatDistance(secDistM, units, precision, true)} (${distPct}% ${ofTrail})</p>
			<p><span class="font-medium">${t('sectionAscent')}</span> ${formatElevation(secAscent, units)} (${ascentPct}% ${ofTrail})</p>
			<p><span class="font-medium">${t('sectionDescent')}</span> ${formatElevation(secDescent, units)} (${descentPct}% ${ofTrail})</p>
			<p><span class="font-medium">${t('sectionAvgPassageTime')}</span> ${estimatedDays} ${t('sectionDays')}</p>
		</div>
	`;
}

interface TrailRouteProps {
	pathOptions?: L.PathOptions;
}

export default function TrailRoute({ pathOptions = DEFAULT_PATH_OPTIONS }: TrailRouteProps): React.ReactElement | null {
	const t = useTranslations('trailRoute');
	const tChart = useTranslations('elevationChart');
	const locale = useLocale();
	const map = useMap();
	const routeLayerRef = useRef<L.FeatureGroup | null>(null);
	const sectionLayersRef = useRef<L.Polyline[]>([]);
	const sectionBoundaryMarkersRef = useRef<L.Marker[]>([]);
	const sectionStatsRef = useRef<
		Array<{
			startDistM: number;
			endDistM: number;
			secDistM: number;
			secAscent: number;
			secDescent: number;
			sectionIndex: number;
		}>
	>([]);
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
	const showSections = useMapStore((state: MapStoreState) => state.showSections);

	const highlightedPoint = useStore((state: StoreState) => state.highlightedTrailPoint);
	const tooltipPinnedFromShare = useStore((state: StoreState) => state.tooltipPinnedFromShare);
	const highlightTrailPosition = useStore((state: StoreState) => state.highlightTrailPosition);
	const clearTrailHighlight = useStore((state: StoreState) => state.clearTrailHighlight);
	const trailMetadata = useStore((state: StoreState) => state.trailMetadata);

	const setRawGpxData = useMapStore((state: MapStoreState) => state.setRawGpxData);
	const setGpxElevationPoints = useMapStore((state: MapStoreState) => state.setGpxElevationPoints);
	const setGpxLoaded = useMapStore((state: MapStoreState) => state.setGpxLoaded);
	const setGpxLoadFailed = useMapStore((state: MapStoreState) => state.setGpxLoadFailed);
	const reloadTrailRequested = useMapStore((state: MapStoreState) => state.reloadTrailRequested);
	const processTrailData = useMapStore((state: MapStoreState) => state.processTrailData);

	interface TrailPoint {
		lat: number;
		lng: number;
		elevation?: number;
		distanceFromStart?: number;
		elevationGainFromStart?: number;
		elevationLossFromStart?: number;
		sectionName?: string;
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
		sectionLayersRef.current = [];
		for (const m of sectionBoundaryMarkersRef.current) {
			m.removeFrom(map);
		}
		sectionBoundaryMarkersRef.current = [];
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
			const distKm = distanceFromStart / 1000;
			const section = TRAIL_SECTIONS.find((s) => distKm >= s.startKm && distKm < s.endKm);
			const sectionKey = point.sectionName ?? section?.nameKey;
			const sectionLabel = sectionKey ? t(sectionKey) : '';
			const trailInfoHtml = `
        <p><span class="font-bold">${t('tooltipCoordinates')}</span> <span class="trail-tooltip-coords-link font-bold" data-lat="${lat}" data-lng="${lng}" role="button" tabindex="0">${coordsFormatted}</span></p>
        ${sectionLabel ? `<p><span class="font-medium">${t('tooltipSection')}</span> ${sectionLabel}</p>` : ''}
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
				className: 'map-tooltip map-tooltip--wide',
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
					// Compute cumulative distances to split points into sections.
					const latLngPoints = directionAdjustedPoints.map((p) => {
						const tuple = p as L.LatLngTuple;
						return L.latLng(tuple[0], tuple[1]);
					});
					let cumDistM = 0;
					const cumDistances: number[] = [0];
					for (let i = 1; i < latLngPoints.length; i++) {
						cumDistM += latLngPoints[i - 1].distanceTo(latLngPoints[i]);
						cumDistances.push(cumDistM);
					}

					const featureGroup = L.featureGroup();
					const sectionPolylines: L.Polyline[] = [];

					// Helper: attach shared mousemove/mouseout/click handlers to a polyline.
					const attachPolylineHandlers = (pl: L.Polyline): void => {
						pl.on('mousemove', (e) => {
							if (useMapStore.getState().isRulerEnabled) return;
							if (useStore.getState().tooltipPinnedFromShare) return;
							if (highlightTrailPosition) highlightTrailPosition({ lat: e.latlng.lat, lng: e.latlng.lng });
						});
						pl.on('mouseout', () => {
							if (isTooltipPinnedByClickRef.current) return;
							if (useStore.getState().tooltipPinnedFromShare) return;
							if (clearTrailHighlight) clearTrailHighlight();
						});
						pl.on('click', (e) => {
							if (useMapStore.getState().isRulerEnabled) return;
							lastRouteClickTimeRef.current = Date.now();
							isTooltipPinnedByClickRef.current = true;
							if (useStore.getState().tooltipPinnedFromShare) {
								useStore.getState().setTooltipPinnedFromShare?.(false);
								clearShareUrlParams();
							}
							if (highlightTrailPosition) {
								highlightTrailPosition({ lat: e.latlng.lat, lng: e.latlng.lng });
								setIsTooltipVisible(true);
							}
						});
					};

					if (showSections) {
						const totalDistanceM = cumDistances[cumDistances.length - 1];
						// Position along trail (km from SOBO start): section boundaries are defined in this space.
						const positionAlongTrailKm = (idx: number): number =>
							direction === 'SOBO' ? cumDistances[idx] / 1000 : (totalDistanceM - cumDistances[idx]) / 1000;

						// Bucket points by geographic section (0=A, 1=B, 2=C by position along trail). Ascent/descent in direction of travel.
						const sectionPointGroups: L.LatLngExpression[][] = TRAIL_SECTIONS.map(() => []);
						const sectionFirstIdx: number[] = new Array(TRAIL_SECTIONS.length).fill(-1);
						const sectionLastIdx: number[] = new Array(TRAIL_SECTIONS.length).fill(-1);
						const sectionAscentM: number[] = new Array(TRAIL_SECTIONS.length).fill(0);
						const sectionDescentM: number[] = new Array(TRAIL_SECTIONS.length).fill(0);

						for (let i = 0; i < directionAdjustedPoints.length; i++) {
							const trailKm = positionAlongTrailKm(i);
							const sIdx = TRAIL_SECTIONS.findIndex((s) => trailKm >= s.startKm && trailKm < s.endKm);
							const resolvedIdx = sIdx >= 0 ? sIdx : TRAIL_SECTIONS.length - 1;
							sectionPointGroups[resolvedIdx].push(directionAdjustedPoints[i]);
							if (sectionFirstIdx[resolvedIdx] === -1) sectionFirstIdx[resolvedIdx] = i;
							sectionLastIdx[resolvedIdx] = i;
							// Share boundary point with next section to avoid visual gaps.
							if (
								i + 1 < directionAdjustedPoints.length &&
								TRAIL_SECTIONS.findIndex((s) => {
									const nextTrailKm = positionAlongTrailKm(i + 1);
									return nextTrailKm >= s.startKm && nextTrailKm < s.endKm;
								}) !== resolvedIdx
							) {
								sectionPointGroups[resolvedIdx].push(directionAdjustedPoints[i + 1]);
							}
							// Elevation change in direction of travel: attribute to the section of the segment start (i-1) by position along trail.
							if (i > 0 && directionAdjustedElevPoints[i] && directionAdjustedElevPoints[i - 1]) {
								const elevDiff =
									directionAdjustedElevPoints[i].elevation - directionAdjustedElevPoints[i - 1].elevation;
								const prevTrailKm = positionAlongTrailKm(i - 1);
								const prevSIdx = TRAIL_SECTIONS.findIndex((s) => prevTrailKm >= s.startKm && prevTrailKm < s.endKm);
								const prevResolvedIdx = prevSIdx >= 0 ? prevSIdx : TRAIL_SECTIONS.length - 1;
								if (elevDiff > 0) sectionAscentM[prevResolvedIdx] += elevDiff;
								else sectionDescentM[prevResolvedIdx] += Math.abs(elevDiff);
							}
						}
						const totalAscentM = sectionAscentM.reduce((a, b) => a + b, 0);
						const totalDescentM = sectionDescentM.reduce((a, b) => a + b, 0);
						const currentUnits = useMapStore.getState().units;
						const currentPrecision = useMapStore.getState().distancePrecision;

						// Draw each geographic section with its own label and color (A=green, B=blue, C=red by position along trail).
						const newSectionMarkers: L.Marker[] = [];
						const newSectionStats: typeof sectionStatsRef.current = [];

						for (let si = 0; si < TRAIL_SECTIONS.length; si++) {
							const section = TRAIL_SECTIONS[si];
							const sectionPts = sectionPointGroups[si];
							if (sectionPts.length === 0) continue;

							const sectionPolyline = L.polyline(sectionPts, {
								...pathOptions,
								color: section.color,
								smoothFactor: 1,
								interactive: true,
								bubblingMouseEvents: true,
								weight: pathOptions.weight || 5,
								renderer: L.svg({ padding: 10 }),
							});
							attachPolylineHandlers(sectionPolyline);
							featureGroup.addLayer(sectionPolyline);
							sectionPolylines.push(sectionPolyline);

							const firstPt = sectionPts[0];
							const [lat0, lng0] = firstPt as L.LatLngTuple;
							const fi = sectionFirstIdx[si];
							const li = sectionLastIdx[si];
							const startDistM = fi >= 0 ? cumDistances[fi] : 0;
							const endDistM = li >= 0 ? cumDistances[li] : 0;
							const secDistM = fi >= 0 && li >= 0 ? cumDistances[li] - cumDistances[fi] : 0;
							const secAscent = sectionAscentM[si];
							const secDescent = sectionDescentM[si];

							const stat = {
								startDistM,
								endDistM,
								secDistM,
								secAscent,
								secDescent,
								sectionIndex: si,
							};
							newSectionStats.push(stat);

							const tooltipHtml = buildSectionTooltipHtml(
								stat,
								{ totalDistanceM, totalAscentM, totalDescentM },
								currentUnits,
								currentPrecision,
								t,
							);
							const marker = L.marker(L.latLng(lat0, lng0), {
								icon: sectionBoundaryIcon(section.shortName, si),
								zIndexOffset: 50,
							});
							marker.bindTooltip(tooltipHtml, {
								direction: 'top',
								permanent: false,
								className: 'map-tooltip map-tooltip--section',
							});
							marker.addTo(map);
							newSectionMarkers.push(marker);
						}
						sectionBoundaryMarkersRef.current = newSectionMarkers;
						sectionStatsRef.current = newSectionStats;
					} else {
						// Sections hidden: single default-colored polyline.
						const singlePolyline = L.polyline(directionAdjustedPoints, {
							...pathOptions,
							smoothFactor: 1,
							interactive: true,
							bubblingMouseEvents: true,
							weight: pathOptions.weight || 5,
							renderer: L.svg({ padding: 10 }),
						});
						attachPolylineHandlers(singlePolyline);
						featureGroup.addLayer(singlePolyline);
						sectionPolylines.push(singlePolyline);
						sectionBoundaryMarkersRef.current = [];
						sectionStatsRef.current = [];
					}

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

					featureGroup.addTo(map);
					routeLayerRef.current = featureGroup;
					sectionLayersRef.current = sectionPolylines;

					const directionText = direction === 'SOBO' ? tChart('directionNorthSouth') : tChart('directionSouthNorth');
					const startPoint = L.latLng(
						(directionAdjustedPoints[0] as L.LatLngTuple)[0],
						(directionAdjustedPoints[0] as L.LatLngTuple)[1],
					);
					const finishPoint = L.latLng(
						(directionAdjustedPoints[directionAdjustedPoints.length - 1] as L.LatLngTuple)[0],
						(directionAdjustedPoints[directionAdjustedPoints.length - 1] as L.LatLngTuple)[1],
					);

					// Hide start marker when sections are shown so Section A label is visible.
					if (!showSections) {
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
							className: 'map-tooltip map-tooltip--compact',
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
					} else {
						startMarkerRef.current = null;
					}

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
						className: 'map-tooltip map-tooltip--compact',
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
						map.fitBounds(featureGroup.getBounds(), { padding: [50, 50] });
					}

					if (processTrailData) {
						const latLngs = latLngPoints;
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
		reloadTrailRequested,
		t,
		tChart,
		setRawGpxData,
		setGpxElevationPoints,
		setGpxLoaded,
		setGpxLoadFailed,
		processTrailData,
		highlightTrailPosition,
		clearTrailHighlight,
		showSections,
	]);

	// Update section boundary tooltips when units, precision, or locale change.
	useEffect(() => {
		if (!showSections || sectionBoundaryMarkersRef.current.length === 0 || sectionStatsRef.current.length === 0) {
			return;
		}
		const meta = trailMetadata;
		const totalDistanceM = (meta?.totalDistance ?? 0) * 1000;
		const totalAscentM = meta?.elevationGain ?? 0;
		const totalDescentM = meta?.elevationLoss ?? 0;
		const currentUnits = units;
		const currentPrecision = distancePrecision;

		const markers = sectionBoundaryMarkersRef.current;
		const stats = sectionStatsRef.current;
		for (let i = 0; i < markers.length && i < stats.length; i++) {
			const tooltipHtml = buildSectionTooltipHtml(
				stats[i],
				{ totalDistanceM, totalAscentM, totalDescentM },
				currentUnits,
				currentPrecision,
				t,
			);
			const tooltip = markers[i].getTooltip();
			if (tooltip) {
				tooltip.setContent(tooltipHtml);
			}
		}
	}, [showSections, units, distancePrecision, locale, trailMetadata, t, direction]);

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
