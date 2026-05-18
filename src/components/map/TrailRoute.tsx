'use client';

/**
 * Renders the CLDT trail polyline, start/finish markers, and trail info tooltip on map click or share URL.
 * Fetches GPX, builds enhanced points (distance/elevation), and syncs with the main store and map store.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useMapStore, useStore, type EnhancedTrailPoint, type MapStoreState, type StoreState } from '@/lib/store';
import {
	DEFAULT_PATH_OPTIONS,
	TRAIL_EPSILON_M,
	TOOLTIP_EST_WIDTH,
	TOOLTIP_EST_HEIGHT,
	TOOLTIP_PADDING,
	START_FLAG_SVG,
	FINISH_FLAG_SVG,
	sectionBoundaryIcon,
	GRADE_BAND_ASCENT_COLORS,
	GRADE_BAND_DESCENT_COLORS,
} from '@/components/map/trail-route-constants';
import { TRAIL_SECTIONS } from '@/lib/trail-sections';
import { fetchGPXWithCache } from '@/lib/gpx-cache';
import { parseGpx } from '@/lib/gpx-parser';
import { calculateTrailMetadata, estimatePassageDays } from '@/lib/map';
import { clearShareUrlParams, formatDistance, formatElevation, parseShareUrlParams } from '@/lib/utils';
import {
	fetchWeather,
	buildHourlyStripData,
	formatTemperature,
	formatWindSpeed,
	formatSunTime,
	weatherCodeToKey,
	weatherKeyToIcon,
	type WeatherData,
} from '@/lib/weather';
import {
	TrailTooltipContent,
	type TrailTooltipData,
	type TrailTooltipWeather,
	type TrailTooltipWindCompass,
} from './TrailTooltipContent';
import { buildWindCompassPayload } from '@/lib/distance-utils';
import type { UnitSystem } from '@/lib/types';
import { useLocale, useTranslations } from 'next-intl';
import { useFitToRoute } from '@/hooks';
import { formatSeasonalDateRange, severityColor, type SeasonalStatusEntry } from '@/lib/seasonal-status';

interface SectionTooltipStats {
	/** Distance from current start to section start (m). */
	startDistM: number;
	/** Distance from the current start to the section end (m). */
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
	paceKmh: number,
): string {
	const { startDistM, endDistM, secDistM, secAscent, secDescent, sectionIndex } = stats;
	const section = TRAIL_SECTIONS[sectionIndex];
	const { totalDistanceM, totalAscentM, totalDescentM } = totals;
	const alongTrailStartM = section.startKm * 1000;
	const alongTrailEndM = section.endKm === Infinity ? totalDistanceM : section.endKm * 1000;
	const distPct = totalDistanceM > 0 ? ((secDistM / totalDistanceM) * 100).toFixed(1) : '0.0';
	const ascentPct = totalAscentM > 0 ? ((secAscent / totalAscentM) * 100).toFixed(1) : '0.0';
	const descentPct = totalDescentM > 0 ? ((secDescent / totalDescentM) * 100).toFixed(1) : '0.0';
	const estimatedDays = estimatePassageDays(secDistM, secAscent, paceKmh);
	const ofTrail = t('sectionOfTrail');
	return `
		<div class="map-tooltip__inner">
			<p class="font-bold text-sm mb-1 trail-section-title-${sectionIndex}">${t(section.nameKey)}</p>
			<p><span class="font-medium">${t('sectionAlongTrail')}</span> ${formatDistance(alongTrailStartM, units, precision, true)} - ${formatDistance(alongTrailEndM, units, precision, true)}</p>
			<p><span class="font-medium">${t('sectionFromYourStart')}</span> ${formatDistance(startDistM, units, precision, true)} - ${formatDistance(endDistM, units, precision, true)}</p>
			<p><span class="font-medium">${t('sectionDistance')}</span> ${formatDistance(secDistM, units, precision, true)} (${distPct}% ${ofTrail})</p>
			<p><span class="font-medium">${t('sectionAscent')}</span> ${formatElevation(secAscent, units)} (${ascentPct}% ${ofTrail})</p>
			<p><span class="font-medium">${t('sectionDescent')}</span> ${formatElevation(secDescent, units)} (${descentPct}% ${ofTrail})</p>
			<p><span class="font-medium">${t('sectionAvgPassageTime')}</span> ${estimatedDays} ${t('sectionDays')}</p>
		</div>
	`;
}

/**
 * Walk the direction-adjusted points and bucket each segment by (gradeBand, sign).
 * Returns a 5x2 matrix [band][sign] of LatLng[][] (each entry a contiguous run).
 * sign: 0 = ascent (deltaEle >= 0), 1 = descent.
 */
/** Disjoint polyline runs indexed by [band 0..4][sign: 0 ascent or flat, 1 descent]. */
type GradeBandRuns = L.LatLng[][][][];

interface TrailPoint {
	lat: number;
	lng: number;
	elevation?: number;
	distanceFromStart?: number;
	elevationGainFromStart?: number;
	elevationLossFromStart?: number;
	sectionName?: string;
	bearingDeg: number;
}

function buildGradeBandSegments(enhancedPoints: EnhancedTrailPoint[], pointLatLngs: L.LatLng[]): GradeBandRuns {
	const runs: GradeBandRuns = Array.from({ length: 5 }, () => [[], []]);
	if (enhancedPoints.length < 2) return runs;

	let currentBand: 0 | 1 | 2 | 3 | 4 | null = null;
	let currentSign: 0 | 1 | null = null;
	let currentRun: L.LatLng[] = [];

	const flush = (): void => {
		if (currentRun.length >= 2 && currentBand !== null && currentSign !== null) {
			runs[currentBand][currentSign].push(currentRun);
		}
	};

	for (let i = 0; i < enhancedPoints.length - 1; i++) {
		const a = pointLatLngs[i];
		const b = pointLatLngs[i + 1];
		const band = enhancedPoints[i].gradeBand;
		// Band 0 (flat) shares one color for both directions; collapse to sign 0.
		const sign: 0 | 1 = band === 0 ? 0 : enhancedPoints[i].gradePct >= 0 ? 0 : 1;

		if (band !== currentBand || sign !== currentSign) {
			flush();
			currentBand = band;
			currentSign = sign;
			// Seed the new run with [a, b]: point `a` is shared with the previous run's last
			// point so adjacent band-colored segments meet visually at the boundary vertex.
			currentRun = [a, b];
		} else {
			currentRun.push(b);
		}
	}
	flush();
	return runs;
}

/** Pane for the selected trail point marker (pulsing dot); above ruler, below tooltips. */
const TRAIL_POINT_MARKER_PANE = 'trailPointMarkerPane';
/** Pane for the selected trail point tooltip (wide panel); above ruler and its tooltip. */
const TRAIL_POINT_TOOLTIP_PANE = 'trailPointTooltipPane';
/**
 * Pane for the seasonal-status halo polyline, drawn under the trail when an
 * entry is hovered or has its modal open. Z-index sits just above the base
 * trail so the highlight reads clearly without competing with markers above.
 */
const SEASONAL_STATUS_PANE = 'seasonalStatusPane';
/**
 * Pane for seasonal-status chip markers (one per active entry, at the midpoint
 * of the affected km range). Sits above the halo so the chip is always on top.
 */
const SEASONAL_STATUS_MARKER_PANE = 'seasonalStatusMarkerPane';
/**
 * Pane for the chip-marker hover tooltip. Must outrank the marker pane so the
 * tooltip card sits on top of the chip instead of being clipped behind it.
 */
const SEASONAL_STATUS_TOOLTIP_PANE = 'seasonalStatusTooltipPane';
/** Halo stroke weight in pixels. */
const SEASONAL_STATUS_HALO_WEIGHT = 16;
/** Halo stroke opacity. */
const SEASONAL_STATUS_HALO_OPACITY = 0.32;
/** SVG glyph rendered inside every chip marker (a warning exclamation). */
const SEASONAL_STATUS_CHIP_GLYPH =
	'<svg viewBox="0 0 10 12" width="10" height="12" aria-hidden="true">' +
	'<rect x="4" y="2" width="2" height="6" rx="1" fill="white"/>' +
	'<circle cx="5" cy="10" r="1.2" fill="white"/>' +
	'</svg>';

function escapeHtmlAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSeasonalChipIcon(entry: SeasonalStatusEntry, ariaLabel: string): L.DivIcon {
	const color = severityColor(entry.severity);
	const safeLabel = escapeHtmlAttr(ariaLabel);
	const html =
		`<span class="seasonal-status-chip" style="--seasonal-chip-color:${color};background:${color}" ` +
		`aria-label="${safeLabel}">${SEASONAL_STATUS_CHIP_GLYPH}</span>`;
	return L.divIcon({
		className: 'seasonal-status-chip-wrapper',
		html,
		iconSize: [22, 22],
		iconAnchor: [11, 11],
	});
}

/** Finds the index in `points` whose `distanceFromStart` is closest to `targetM`. */
function nearestPointByDistanceM(points: EnhancedTrailPoint[], targetM: number): number {
	let bestIdx = 0;
	let bestDiff = Infinity;
	for (let i = 0; i < points.length; i++) {
		const diff = Math.abs(points[i].distanceFromStart - targetM);
		if (diff < bestDiff) {
			bestDiff = diff;
			bestIdx = i;
		}
	}
	return bestIdx;
}

interface TrailRouteProps {
	pathOptions?: L.PathOptions;
}

export default function TrailRoute({ pathOptions = DEFAULT_PATH_OPTIONS }: TrailRouteProps): React.ReactElement | null {
	const t = useTranslations('trailRoute');
	const tChart = useTranslations('elevationChart');
	const tControls = useTranslations('mapControls');
	const tWeather = useTranslations('weather');
	const tSeasonal = useTranslations('seasonalStatus');
	const locale = useLocale();
	const map = useMap();
	const routeLayerRef = useRef<L.FeatureGroup | null>(null);
	const sectionLayersRef = useRef<L.Polyline[]>([]);
	const sectionBoundaryMarkersRef = useRef<L.Marker[]>([]);
	const seasonalChipMarkersRef = useRef<Map<string, L.Marker>>(new Map());
	const seasonalHaloRef = useRef<L.Polyline | null>(null);
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
	const tooltipRootRef = useRef<Root | null>(null);
	const startMarkerRef = useRef<L.Marker | null>(null);
	const finishMarkerRef = useRef<L.Marker | null>(null);
	const [isTooltipVisible, setIsTooltipVisible] = useState(false);
	const showMarkerAtPositionRef = useRef<(point: TrailPoint) => void>(() => {});
	const clearMarkerAndTooltipRef = useRef<() => void>(() => {});
	const isTooltipPinnedByClickRef = useRef(false);
	const lastRouteClickTimeRef = useRef(0);
	const mapClickHandlerRef = useRef<((e: L.LeafletMouseEvent) => void) | null>(null);

	useFitToRoute(map, routeLayerRef);

	// Panes for trail point marker and tooltip; z-index order set in map.css.
	useEffect(() => {
		const ensurePane = (name: string, className: string): void => {
			if (map.getPane(name)) return;
			map.createPane(name);
			map.getPane(name)?.classList.add(className);
		};
		ensurePane(TRAIL_POINT_MARKER_PANE, 'trail-point-marker-pane');
		ensurePane(TRAIL_POINT_TOOLTIP_PANE, 'trail-point-tooltip-pane');
		ensurePane(SEASONAL_STATUS_PANE, 'seasonal-status-pane');
		ensurePane(SEASONAL_STATUS_MARKER_PANE, 'seasonal-status-marker-pane');
		ensurePane(SEASONAL_STATUS_TOOLTIP_PANE, 'seasonal-status-tooltip-pane');
	}, [map]);

	const selectedTrail = useMapStore((state: MapStoreState) => state.selectedTrail);
	const direction = useMapStore((state: MapStoreState) => state.direction);
	const units = useMapStore((state: MapStoreState) => state.units);
	const isRulerEnabled = useMapStore((state: MapStoreState) => state.isRulerEnabled);
	const distancePrecision = useMapStore((state: MapStoreState) => state.distancePrecision);
	const showSections = useMapStore((state: MapStoreState) => state.showSections);
	const gradeTintedTrail = useMapStore((state: MapStoreState) => state.gradeTintedTrail);
	const walkingPaceKmh = useMapStore((state: MapStoreState) => state.walkingPaceKmh);
	const seasonalStatusEntries = useMapStore((state: MapStoreState) => state.seasonalStatusEntries);
	const seasonalStatusLayerEnabled = useMapStore((state: MapStoreState) => state.seasonalStatusLayerEnabled);
	const setSeasonalStatusModalEntry = useMapStore((state: MapStoreState) => state.setSeasonalStatusModalEntry);
	const seasonalStatusModalEntry = useMapStore((state: MapStoreState) => state.seasonalStatusModalEntry);
	const seasonalStatusHoveredEntryId = useMapStore((state: MapStoreState) => state.seasonalStatusHoveredEntryId);
	const setSeasonalStatusHoveredEntryId = useMapStore((state: MapStoreState) => state.setSeasonalStatusHoveredEntryId);
	const enhancedTrailPoints = useStore((state: StoreState) => state.enhancedTrailPoints);

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

	// Mirror tooltip-visibility state into refs so showMarkerAtPosition can read the
	// latest value without depending on it. Without this, every visibility toggle
	// changes the callback identity and causes the marker/tooltip to be torn down
	// and rebuilt by the highlight-watching effect. The refs are updated in an
	// effect so we don't write to them during render (react-hooks/refs rule).
	// showMarkerAtPosition is only invoked from event handlers and effect-scheduled
	// callbacks, so the post-commit ref update is in sync by the time it runs.
	const isTooltipVisibleRef = useRef(false);
	const tooltipPinnedFromShareRef = useRef(tooltipPinnedFromShare);
	useEffect(() => {
		isTooltipVisibleRef.current = isTooltipVisible;
		tooltipPinnedFromShareRef.current = tooltipPinnedFromShare;
	}, [isTooltipVisible, tooltipPinnedFromShare]);

	const tooltipLabels = useMemo(
		() => ({
			close: t('close'),
			coordinates: t('tooltipCoordinates'),
			section: t('tooltipSection'),
			elevation: t('tooltipElevation'),
			distanceFromStart: t('tooltipDistanceFromStart'),
			distanceToEnd: t('tooltipDistanceToEnd'),
			distanceToSection: '',
			accumulatedGain: t('tooltipAccumulatedGain'),
			accumulatedLoss: t('tooltipAccumulatedLoss'),
			temperature: `${tWeather('temperature')}:`,
			feelsLike: `${tWeather('feelsLike')}:`,
			precipitation: `${tWeather('precipitation')}:`,
			wind: `${tWeather('wind.label')}:`,
			sunrise: `${tWeather('sunrise')}:`,
			sunset: tWeather('sunset'),
			weatherLoading: tWeather('loading'),
		}),
		[t, tWeather],
	);

	const clearMarkerAndTooltip = useCallback((): void => {
		if (tooltipRootRef.current) {
			tooltipRootRef.current.unmount();
			tooltipRootRef.current = null;
		}
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
				pane: TRAIL_POINT_MARKER_PANE,
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

			const distKm = distanceFromStart / 1000;
			const section = TRAIL_SECTIONS.find((s) => distKm >= s.startKm && distKm < s.endKm);
			const sectionKey = point.sectionName ?? section?.nameKey;
			const pointData: TrailTooltipData = {
				lat: point.lat,
				lng: point.lng,
				sectionLabel: sectionKey ? t(sectionKey) : null,
				elevation: `${formatElevation(currentElevation, currentUnits)} ${tControls('elevationUnitASL')}`,
				distanceFromStart: formatDistance(distanceFromStart, currentUnits, currentPrecision, true),
				distanceFromStartPct: distanceFromStartPct.toFixed(1),
				distanceToEnd: formatDistance(distanceToEnd, currentUnits, currentPrecision, true),
				distanceToEndPct: distanceToEndPct.toFixed(1),
				distanceToSection: null,
				accumulatedGain: elevationGainFromStart > 0 ? formatElevation(elevationGainFromStart, currentUnits) : null,
				accumulatedGainPct: accumulatedGainPct.toFixed(1),
				accumulatedLoss: elevationLossFromStart > 0 ? formatElevation(elevationLossFromStart, currentUnits) : null,
				accumulatedLossPct: accumulatedLossPct.toFixed(1),
			};
			const tooltipContainer = document.createElement('div');
			const tooltipRoot = createRoot(tooltipContainer);
			const onClose = (): void => {
				clearTrailHighlight?.(true);
				clearShareUrlParams();
			};
			const buildWeather = (weatherData: WeatherData | null): TrailTooltipWeather | null => {
				if (!weatherData) return null;
				const key = weatherCodeToKey(weatherData.weatherCode);
				return {
					icon: weatherKeyToIcon(key),
					condition: tWeather(key),
					temperature: formatTemperature(weatherData.temperatureC, currentUnits),
					feelsLike: formatTemperature(weatherData.feelsLikeC, currentUnits),
					precipitation: `${weatherData.precipitationProbabilityPct}%`,
					wind: formatWindSpeed(weatherData.windspeedKmh, currentUnits),
					sunrise: formatSunTime(weatherData.sunrise, currentUnits),
					sunset: formatSunTime(weatherData.sunset, currentUnits),
				};
			};
			const buildWindCompass = (weatherData: WeatherData | null): TrailTooltipWindCompass | null => {
				if (!weatherData) return null;
				const payload = buildWindCompassPayload(weatherData.windFromDeg, weatherData.windspeedKmh, point.bearingDeg);
				if (!payload) return null;
				return {
					relativeAngle: payload.relativeAngle,
					label: `${tWeather(`wind.${payload.cls}`)} ${Math.round(Math.abs(payload.relativeAngle))}°`,
				};
			};
			const renderTooltip = (weatherData: WeatherData | null, weatherLoading: boolean): void => {
				tooltipRoot.render(
					<TrailTooltipContent
						showClose
						hourlyStrip={buildHourlyStripData(weatherData, currentUnits, tWeather)}
						labels={tooltipLabels}
						trailData={pointData}
						weather={buildWeather(weatherData)}
						weatherLoading={weatherLoading}
						windCompass={buildWindCompass(weatherData) ?? undefined}
						onClose={onClose}
					/>,
				);
			};

			renderTooltip(null, true);
			tooltipRootRef.current = tooltipRoot;

			// Fetch weather and re-render once data arrives; if fetch fails weatherData is null and loading state clears.
			void fetchWeather(point.lat, point.lng).then((weatherData) => {
				if (tooltipRootRef.current === tooltipRoot) {
					renderTooltip(weatherData, false);
				}
			});

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
				pane: TRAIL_POINT_TOOLTIP_PANE,
				offset,
				direction: dir,
				permanent: isTooltipVisibleRef.current || tooltipPinnedFromShareRef.current,
				className: 'map-tooltip map-tooltip--wide',
			})
				.setLatLng(markerPosition)
				.setContent(tooltipContainer)
				.addTo(map);

			const el = tooltip.getElement();
			if (el) {
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
		[map, clearTrailHighlight, t, tControls, tWeather, tooltipLabels],
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

				if (setRawGpxData) {
					setRawGpxData(result.data);
				}

				const parsed = parseGpx(result.data);
				const trackPts = parsed.tracks[0]?.points ?? [];
				const points: L.LatLngExpression[] = trackPts.map(({ lat, lng }) => [lat, lng] as L.LatLngTuple);
				const hasElevation = trackPts.some((p) => p.ele !== undefined && p.ele !== null);
				const elevationPoints = trackPts.map(({ lat, lng, ele }) => ({
					lat,
					lng,
					elevation: ele ?? 0,
				}));

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

					// Enrich early so `enhancedTrailPoints` (with gradeBand/gradePct) is in the store
					// before the grade-tinted render branch consumes it. Both stores hold parallel trail
					// state; their enrichment actions are independent and each must be invoked.
					const computedMetadata = calculateTrailMetadata(latLngPoints, directionAdjustedElevPoints);
					const processArgs = [
						latLngPoints,
						directionAdjustedElevPoints,
						computedMetadata.startPoint,
						computedMetadata.endPoint,
						computedMetadata.totalDistance / 1000,
						computedMetadata.elevationGain,
						computedMetadata.elevationLoss,
					] as const;
					processTrailData?.(...processArgs);
					useStore.getState().processTrailData?.(...processArgs);

					const featureGroup = L.featureGroup();
					const sectionPolylines: L.Polyline[] = [];

					// Shared SVG renderer and base polyline options for all render branches.
					const svgRenderer = L.svg({ padding: 10 });
					const basePolylineOptions: L.PolylineOptions = {
						...pathOptions,
						smoothFactor: 1,
						interactive: true,
						bubblingMouseEvents: true,
						weight: pathOptions.weight || 5,
						renderer: svgRenderer,
					};

					const attachPolylineHandlers = (pl: L.Polyline): void => {
						pl.on('click', (e) => {
							if (useMapStore.getState().isRulerEnabled) return;
							lastRouteClickTimeRef.current = Date.now();
							isTooltipPinnedByClickRef.current = true;
							if (useStore.getState().tooltipPinnedFromShare) {
								useStore.getState().setTooltipPinnedFromShare?.(false);
								clearShareUrlParams();
							}
							if (highlightTrailPosition) {
								// Use larger maxDistance so any click on the route finds the nearest point (sparse GPX can exceed 150m between points).
								highlightTrailPosition({
									lat: e.latlng.lat,
									lng: e.latlng.lng,
									maxDistance: 2000,
								});
								setIsTooltipVisible(true);
								// Show the marker /tooltip immediately so it appears without needing to move the cursor.
								const point = useStore.getState().highlightedTrailPoint;
								if (point) {
									showMarkerAtPositionRef.current(point);
								}
							}
						});
					};

					// Default ref state; the showSections branch overwrites with its own values.
					sectionBoundaryMarkersRef.current = [];
					sectionStatsRef.current = [];

					// Grade tinting requires elevation data; fall back to default rendering when absent.
					const showGradeTinted = gradeTintedTrail && hasElevation;

					if (showGradeTinted) {
						const enhancedPoints = useStore.getState().enhancedTrailPoints;
						const runs = buildGradeBandSegments(enhancedPoints, latLngPoints);

						for (let band = 0; band < 5; band++) {
							for (let sign = 0; sign < 2; sign++) {
								const segments = runs[band][sign];
								if (segments.length === 0) continue;
								const color =
									sign === 0
										? GRADE_BAND_ASCENT_COLORS[band as 0 | 1 | 2 | 3 | 4]
										: GRADE_BAND_DESCENT_COLORS[band as 0 | 1 | 2 | 3 | 4];
								// MultiLineString form: L.polyline accepts LatLng[][] for grouped segments.
								const polyline = L.polyline(segments, { ...basePolylineOptions, color });
								attachPolylineHandlers(polyline);
								featureGroup.addLayer(polyline);
								sectionPolylines.push(polyline);
							}
						}
					} else if (showSections) {
						const totalDistanceM = cumDistances[cumDistances.length - 1];
						// Position along trail (km from SOBO start): section boundaries are defined in this space.
						const positionAlongTrailKm = (idx: number): number =>
							direction === 'SOBO' ? cumDistances[idx] / 1000 : (totalDistanceM - cumDistances[idx]) / 1000;

						// Bucket points by geographic section (0=A, 1=B, 2=C by position along trail). Ascent/descent in a direction of travel.
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
							// Share the boundary point with the next section to avoid visual gaps.
							if (
								i + 1 < directionAdjustedPoints.length &&
								TRAIL_SECTIONS.findIndex((s) => {
									const nextTrailKm = positionAlongTrailKm(i + 1);
									return nextTrailKm >= s.startKm && nextTrailKm < s.endKm;
								}) !== resolvedIdx
							) {
								sectionPointGroups[resolvedIdx].push(directionAdjustedPoints[i + 1]);
							}
							// Elevation change in a direction of travel: attribute to the section of the segment start (i-1) by position along the trail.
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
						const currentPaceKmh = useMapStore.getState().walkingPaceKmh;

						// Draw each geographic section with its own label and color (A=green, B=blue, C=red by position along the trail).
						const newSectionMarkers: L.Marker[] = [];
						const newSectionStats: typeof sectionStatsRef.current = [];

						for (let si = 0; si < TRAIL_SECTIONS.length; si++) {
							const section = TRAIL_SECTIONS[si];
							const sectionPts = sectionPointGroups[si];
							if (sectionPts.length === 0) continue;

							const sectionPolyline = L.polyline(sectionPts, { ...basePolylineOptions, color: section.color });
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
								currentPaceKmh,
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
						const singlePolyline = L.polyline(directionAdjustedPoints, basePolylineOptions);
						attachPolylineHandlers(singlePolyline);
						featureGroup.addLayer(singlePolyline);
						sectionPolylines.push(singlePolyline);
					}

					const handleMapClick = (e: L.LeafletMouseEvent): void => {
						if (Date.now() - lastRouteClickTimeRef.current < 100) {
							return;
						}
						if (useStore.getState().tooltipPinnedFromShare) {
							return;
						}
						const tooltipEl = tooltipRef.current?.getElement();
						if (tooltipEl?.contains(e.originalEvent.target as Node)) {
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

					// Hide the start marker when sections or grade tinting are shown so the colored layer is unobstructed.
					if (!showSections && !gradeTintedTrail) {
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
		// pathOptions is intentionally omitted: it is a module-level constant by default; including
		// it would trigger a full trail rebuild if a caller ever passed an inline object.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		map,
		removeRouteAndMarkersFromMap,
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
		gradeTintedTrail,
	]);

	// Build one chip marker per active seasonal-status entry, anchored at the
	// midpoint of the entry's km range. Hover sets the hovered-entry id (which
	// drives the halo); click opens the modal. Direction is unused here because
	// distanceFromStart is direction-agnostic SOBO meters.
	useEffect(() => {
		if (!map) return;

		const markers = seasonalChipMarkersRef.current;
		// Tear down previous markers before deciding whether to draw new ones.
		markers.forEach((m) => {
			map.removeLayer(m);
		});
		markers.clear();

		if (!seasonalStatusLayerEnabled) return;
		if (!enhancedTrailPoints || enhancedTrailPoints.length < 2) return;
		if (seasonalStatusEntries.length === 0) return;

		const drawable = seasonalStatusEntries.filter(
			(e) => typeof e.distanceStartKm === 'number' && typeof e.distanceEndKm === 'number',
		);

		for (const entry of drawable) {
			const startKm = entry.distanceStartKm as number;
			const endKm = entry.distanceEndKm as number;
			const midM = ((startKm + endKm) / 2) * 1000;
			const idx = nearestPointByDistanceM(enhancedTrailPoints, midM);
			const pt = enhancedTrailPoints[idx];

			const ariaLabel = tSeasonal('chipAriaLabel', {
				severity: tSeasonal(`severity.${entry.severity}`),
				source: entry.source,
			});
			const icon = buildSeasonalChipIcon(entry, ariaLabel);
			const marker = L.marker(L.latLng(pt.lat, pt.lng), {
				icon,
				pane: SEASONAL_STATUS_MARKER_PANE,
				keyboard: true,
				riseOnHover: true,
			});
			const severityLabel = tSeasonal(`severity.${entry.severity}`);
			const dateRange = formatSeasonalDateRange(entry.validFrom, entry.validUntil, locale);
			const validLabel = tSeasonal('validLabel');
			const tooltipHtml =
				`<div class="map-tooltip__inner">` +
				`<p class="font-semibold text-sm mb-0.5" style="color:${severityColor(entry.severity)}">${escapeHtmlAttr(severityLabel)}</p>` +
				`<p class="text-xs">${escapeHtmlAttr(entry.source)}</p>` +
				`<p class="text-xs opacity-75 mt-0.5"><span class="font-medium">${escapeHtmlAttr(validLabel)}</span> ${escapeHtmlAttr(dateRange)}</p>` +
				`</div>`;
			marker.bindTooltip(tooltipHtml, {
				direction: 'top',
				offset: L.point(0, -8),
				permanent: false,
				className: 'map-tooltip map-tooltip--compact',
				pane: SEASONAL_STATUS_TOOLTIP_PANE,
			});
			marker.on('mouseover', () => {
				setSeasonalStatusHoveredEntryId(entry.id);
			});
			marker.on('mouseout', () => {
				setSeasonalStatusHoveredEntryId(null);
			});
			marker.on('click', (e: L.LeafletMouseEvent) => {
				L.DomEvent.stopPropagation(e);
				setSeasonalStatusModalEntry(entry);
			});
			marker.addTo(map);
			markers.set(entry.id, marker);
		}

		return () => {
			markers.forEach((m) => {
				map.removeLayer(m);
			});
			markers.clear();
		};
	}, [
		map,
		enhancedTrailPoints,
		seasonalStatusEntries,
		seasonalStatusLayerEnabled,
		setSeasonalStatusHoveredEntryId,
		setSeasonalStatusModalEntry,
		tSeasonal,
		locale,
	]);

	// Render a halo polyline along the affected range for whichever entry is
	// currently "active" (hovered OR open in the modal). The active marker also
	// gets an `is-active` class so its chip can light up.
	useEffect(() => {
		if (!map) return;

		const activeEntryId = seasonalStatusHoveredEntryId ?? seasonalStatusModalEntry?.id ?? null;

		// Update marker active-state classes.
		seasonalChipMarkersRef.current.forEach((marker, id) => {
			const el = marker.getElement();
			if (el) el.classList.toggle('is-active', id === activeEntryId);
		});

		// Tear down any existing halo before deciding whether to redraw.
		if (seasonalHaloRef.current) {
			map.removeLayer(seasonalHaloRef.current);
			seasonalHaloRef.current = null;
		}

		if (!activeEntryId) return;
		if (!seasonalStatusLayerEnabled) return;
		if (!enhancedTrailPoints || enhancedTrailPoints.length < 2) return;

		const activeEntry = seasonalStatusEntries.find((e) => e.id === activeEntryId);
		if (!activeEntry) return;
		if (typeof activeEntry.distanceStartKm !== 'number' || typeof activeEntry.distanceEndKm !== 'number') {
			return;
		}

		const startM = activeEntry.distanceStartKm * 1000;
		const endM = activeEntry.distanceEndKm * 1000;
		const haloCoords: L.LatLngTuple[] = [];
		for (const p of enhancedTrailPoints) {
			if (p.distanceFromStart >= startM && p.distanceFromStart <= endM) {
				haloCoords.push([p.lat, p.lng]);
			}
		}
		if (haloCoords.length < 2) return;

		const halo = L.polyline(haloCoords, {
			color: severityColor(activeEntry.severity),
			weight: SEASONAL_STATUS_HALO_WEIGHT,
			opacity: SEASONAL_STATUS_HALO_OPACITY,
			lineCap: 'round',
			lineJoin: 'round',
			interactive: false,
			pane: SEASONAL_STATUS_PANE,
		});
		halo.addTo(map);
		seasonalHaloRef.current = halo;

		return () => {
			if (seasonalHaloRef.current) {
				map.removeLayer(seasonalHaloRef.current);
				seasonalHaloRef.current = null;
			}
		};
	}, [
		map,
		seasonalStatusHoveredEntryId,
		seasonalStatusModalEntry,
		seasonalStatusEntries,
		seasonalStatusLayerEnabled,
		enhancedTrailPoints,
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
				walkingPaceKmh,
			);
			const tooltip = markers[i].getTooltip();
			if (tooltip) {
				tooltip.setContent(tooltipHtml);
			}
		}
	}, [showSections, units, distancePrecision, locale, trailMetadata, t, direction, walkingPaceKmh]);

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
