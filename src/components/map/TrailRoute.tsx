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
	SURFACE_COLORS,
	SAC_COLORS,
} from '@/components/map/trail-route-constants';
import { bucketSac, bucketSurface, findRunAtKm, type SacBucket, type SurfaceBucket } from '@/lib/trail-osm-tags';
import {
	computeSurfaceBreakdownBySection,
	surfaceMixForSection,
	type SurfaceMixEntry,
} from '@/lib/surface-section-stats';
import { TRAIL_SECTIONS } from '@/lib/trail-sections';
import { fetchGPXWithCache } from '@/lib/gpx-cache';
import { computeTrailDataInWorker } from '@/lib/trail-compute-client';
import { computedTrailCacheKey, loadComputedTrail, saveComputedTrail } from '@/lib/trail-compute-cache';
import { parseGpx } from '@/lib/gpx-parser';
import { calculateTrailMetadata, estimatePassageDays } from '@/lib/map';
import {
	clearShareUrlParams,
	formatDistance,
	formatElevation,
	getInitialShareUrlParams,
	shareParamsSkipInitialTrailFitBounds,
} from '@/lib/utils';
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
import { tooltipExposure } from '@/lib/exposure-risk';
import {
	TrailTooltipContent,
	type TrailTooltipData,
	type TrailTooltipWeather,
	type TrailTooltipWindCompass,
} from './TrailTooltipContent';
import { buildWindCompassPayload } from '@/lib/distance-utils';
import type { UnitSystem } from '@/lib/types';
import { useLocale, useTranslations } from 'next-intl';
import { useFitToRoute, usePackAdjustedPaceKmh, packAdjustedPaceKmhFromState } from '@/hooks';

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

function buildSurfaceMixHtml(
	entries: SurfaceMixEntry[],
	heading: string,
	bucketLabel: (bucket: SurfaceBucket) => string,
): string {
	if (entries.length === 0) return '';
	const rows = entries
		.map((e) => {
			const color = SURFACE_COLORS[e.bucket];
			const label = bucketLabel(e.bucket);
			const pct = e.pct >= 10 ? e.pct.toFixed(0) : e.pct.toFixed(1);
			return `<li><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};vertical-align:middle;margin-right:4px" aria-hidden="true"></span>${label} ${pct}%</li>`;
		})
		.join('');
	return `<p class="font-medium mt-1 mb-0.5">${heading}</p><ul class="list-none m-0 p-0 text-xs">${rows}</ul>`;
}

function buildSectionTooltipHtml(
	stats: SectionTooltipStats,
	totals: { totalDistanceM: number; totalAscentM: number; totalDescentM: number },
	units: UnitSystem,
	precision: number,
	t: (key: string) => string,
	paceKmh: number,
	surfaceMix: SurfaceMixEntry[] | null,
	surfaceBucketLabel: (bucket: SurfaceBucket) => string,
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
	const surfaceHtml =
		surfaceMix && surfaceMix.length > 0
			? buildSurfaceMixHtml(surfaceMix, t('sectionSurfaceMix'), surfaceBucketLabel)
			: '';
	return `
		<div class="map-tooltip__inner">
			<p class="font-bold text-sm mb-1 trail-section-title-${sectionIndex}">${t(section.nameKey)}</p>
			<p><span class="font-medium">${t('sectionAlongTrail')}</span> ${formatDistance(alongTrailStartM, units, precision, true)} - ${formatDistance(alongTrailEndM, units, precision, true)}</p>
			<p><span class="font-medium">${t('sectionFromYourStart')}</span> ${formatDistance(startDistM, units, precision, true)} - ${formatDistance(endDistM, units, precision, true)}</p>
			<p><span class="font-medium">${t('sectionDistance')}</span> ${formatDistance(secDistM, units, precision, true)} (${distPct}% ${ofTrail})</p>
			<p><span class="font-medium">${t('sectionAscent')}</span> ${formatElevation(secAscent, units)} (${ascentPct}% ${ofTrail})</p>
			<p><span class="font-medium">${t('sectionDescent')}</span> ${formatElevation(secDescent, units)} (${descentPct}% ${ofTrail})</p>
			<p><span class="font-medium">${t('sectionAvgPassageTime')}</span> ${estimatedDays} ${t('sectionDays')}</p>
			${surfaceHtml}
		</div>
	`;
}

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

/**
 * Walks the trail and groups consecutive segments by their OSM-derived bucket
 * (surface or SAC scale). Returns `Map<bucketKey, LatLng[][]>` ready to feed
 * into one polyline per bucket. The caller resolves bucket -> color and
 * renders. SOBO-direction km is looked up via `soboKmForIdx(idx)` so the
 * direction-agnostic OSM tag runs the map correctly even when the trail is
 * traversed NOBO.
 *
 * If the lookup returns null for a point (km outside the tag dataset or no
 * way found within the snap radius), the point is bucketed as 'unknown' /
 * 'untagged' so it still renders rather than dropping out of the polyline.
 */
function buildTagBandSegments<K extends string>(
	pointLatLngs: L.LatLng[],
	soboKmForIdx: (idx: number) => number,
	bucketAt: (km: number) => K,
): Map<K, L.LatLng[][]> {
	const result = new Map<K, L.LatLng[][]>();
	if (pointLatLngs.length < 2) return result;

	let currentKey: K | null = null;
	let currentRun: L.LatLng[] = [];

	const flush = (): void => {
		if (currentRun.length >= 2 && currentKey !== null) {
			const existing = result.get(currentKey) ?? [];
			existing.push(currentRun);
			result.set(currentKey, existing);
		}
	};

	for (let i = 0; i < pointLatLngs.length - 1; i++) {
		const a = pointLatLngs[i];
		const b = pointLatLngs[i + 1];
		const key = bucketAt(soboKmForIdx(i));

		if (key !== currentKey) {
			flush();
			currentKey = key;
			// Seed with [a, b] so adjacent bucket runs share a vertex (no visual gap).
			currentRun = [a, b];
		} else {
			currentRun.push(b);
		}
	}
	flush();
	return result;
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

interface TrailRouteProps {
	pathOptions?: L.PathOptions;
}

export default function TrailRoute({ pathOptions = DEFAULT_PATH_OPTIONS }: TrailRouteProps): React.ReactElement | null {
	const t = useTranslations('trailRoute');
	const tChart = useTranslations('elevationChart');
	const tControls = useTranslations('mapControls');
	const tSurfaceBucket = useTranslations('mapControls.layers.trailStyle.surfaceBuckets');
	const tWeather = useTranslations('weather');
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
	const tooltipRootRef = useRef<Root | null>(null);
	const weatherAbortRef = useRef<AbortController | null>(null);
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
	}, [map]);

	const selectedTrail = useMapStore((state: MapStoreState) => state.selectedTrail);
	const direction = useMapStore((state: MapStoreState) => state.direction);
	const units = useMapStore((state: MapStoreState) => state.units);
	const isRulerEnabled = useMapStore((state: MapStoreState) => state.isRulerEnabled);
	const distancePrecision = useMapStore((state: MapStoreState) => state.distancePrecision);
	const showSections = useMapStore((state: MapStoreState) => state.showSections);
	const gradeTintedTrail = useMapStore((state: MapStoreState) => state.gradeTintedTrail);
	const surfaceColoured = useMapStore((state: MapStoreState) => state.surfaceColoured);
	const sacColoured = useMapStore((state: MapStoreState) => state.sacColoured);
	const trailOsmTagsFile = useMapStore((state: MapStoreState) => state.trailOsmTagsFile);
	// `null` when neither Surface nor SAC is active, so an async OSM data load
	// does not re-trigger the trail-loading effect when no visible bucket branch
	// would consume `tagRuns`.
	const activeOsmTagsFile = surfaceColoured || sacColoured ? trailOsmTagsFile : null;
	const walkingPaceKmh = usePackAdjustedPaceKmh();

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
	// effect, so we don't write to them during render (react-hooks/refs rule).
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
		// Cancel any in-flight weather request for the tooltip being torn down,
		// so a slow response can't waste bandwidth or race a newer tooltip.
		if (weatherAbortRef.current) {
			weatherAbortRef.current.abort();
			weatherAbortRef.current = null;
		}
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
					exposure: tooltipExposure(weatherData.feelsLikeC, weatherData.windspeedKmh, tWeather),
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
			// The AbortController cancels the request when this tooltip is replaced or torn down
			// (clearMarkerAndTooltip aborts); the identity check below is the render-side guard.
			weatherAbortRef.current?.abort();
			const weatherAbort = new AbortController();
			weatherAbortRef.current = weatherAbort;
			void fetchWeather(point.lat, point.lng, weatherAbort.signal).then((weatherData) => {
				if (weatherAbort.signal.aborted) return;
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

				// Persisted-compute first: a prior visit's enhanced dataset (keyed by
				// GPX cache version + direction) lets repeat loads and SOBO<->NOBO
				// flips skip the parse + O(n) enhancement entirely - the largest
				// cold-load block. On a miss, fall back to the worker (parse + enhance
				// off the main thread) and persist its output for next time; any
				// worker failure drops to the historical synchronous path below.
				const computedKey = computedTrailCacheKey(result.version, direction);
				let workerData = await loadComputedTrail(computedKey);
				if (!workerData) {
					workerData = await computeTrailDataInWorker(result.data, direction).catch(() => null);
					if (workerData) void saveComputedTrail(computedKey, workerData);
				}

				if (!isMounted) {
					return;
				}

				let latLngPoints: L.LatLng[];
				let cumDistances: number[];
				let hasElevation: boolean;
				let directionAdjustedElevPoints: { lat: number; lng: number; elevation: number }[];
				let directionAdjustedPoints: L.LatLngExpression[];

				if (workerData && workerData.points.length > 0) {
					// Worker output is already direction-adjusted; the only
					// main-thread loops left are cheap materialisations.
					latLngPoints = workerData.points.map((p) => L.latLng(p.lat, p.lng));
					directionAdjustedPoints = latLngPoints;
					cumDistances = workerData.enhanced.map((p) => p.distanceFromStart);
					hasElevation = workerData.hasElevation;
					directionAdjustedElevPoints = workerData.elevationPoints;

					useStore.getState().applyComputedTrailData?.(workerData);
					processTrailData?.(
						latLngPoints,
						directionAdjustedElevPoints,
						latLngPoints[0] ?? null,
						latLngPoints[latLngPoints.length - 1] ?? null,
						workerData.metadata.totalDistanceM / 1000,
						workerData.metadata.elevationGain,
						workerData.metadata.elevationLoss,
					);
				} else {
					const parsed = parseGpx(result.data);
					const trackPts = parsed.tracks[0]?.points ?? [];
					const points: L.LatLngExpression[] = trackPts.map(({ lat, lng }) => [lat, lng] as L.LatLngTuple);
					hasElevation = trackPts.some((p) => p.ele !== undefined && p.ele !== null);
					const elevationPoints = trackPts.map(({ lat, lng, ele }) => ({
						lat,
						lng,
						elevation: ele ?? 0,
					}));

					directionAdjustedPoints = direction === 'NOBO' ? [...points].reverse() : points;
					directionAdjustedElevPoints = direction === 'NOBO' ? [...elevationPoints].reverse() : elevationPoints;

					// Compute cumulative distances to split points into sections.
					latLngPoints = directionAdjustedPoints.map((p) => {
						const tuple = p as L.LatLngTuple;
						return L.latLng(tuple[0], tuple[1]);
					});
					let cumDistM = 0;
					cumDistances = [0];
					for (let i = 1; i < latLngPoints.length; i++) {
						cumDistM += latLngPoints[i - 1].distanceTo(latLngPoints[i]);
						cumDistances.push(cumDistM);
					}

					if (latLngPoints.length > 0) {
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
					}
				}

				if (latLngPoints.length > 0) {
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

					// SOBO-direction km lookup: the OSM tag dataset is direction-agnostic
					// (always indexed from the SOBO start), so when the user traverses NOBO,
					// we mirror the cum-distance back to SOBO space before binary-searching.
					const totalDistanceMLocal = cumDistances[cumDistances.length - 1];
					const soboKmForIdx = (idx: number): number =>
						direction === 'SOBO' ? cumDistances[idx] / 1000 : (totalDistanceMLocal - cumDistances[idx]) / 1000;

					// Trail style priority: sac > surface > grade > sections > default.
					// Surface and SAC both require the OSM tag dataset; if it's missing, we
					// silently fall through to the next style rather than rendering nothing.
					const showGradeTinted = gradeTintedTrail && hasElevation;
					const tagRuns = trailOsmTagsFile?.runs ?? null;
					const showSurfaceColoured = surfaceColoured && tagRuns !== null && tagRuns.length > 0;
					const showSacColoured = sacColoured && tagRuns !== null && tagRuns.length > 0;

					if (showSacColoured) {
						const runsByBucket = buildTagBandSegments<SacBucket>(latLngPoints, soboKmForIdx, (km) =>
							bucketSac(findRunAtKm(tagRuns, km)?.sac_scale ?? null),
						);
						for (const [bucket, segments] of runsByBucket) {
							if (segments.length === 0) continue;
							const polyline = L.polyline(segments, { ...basePolylineOptions, color: SAC_COLORS[bucket] });
							attachPolylineHandlers(polyline);
							featureGroup.addLayer(polyline);
							sectionPolylines.push(polyline);
						}
					} else if (showSurfaceColoured) {
						const runsByBucket = buildTagBandSegments<SurfaceBucket>(latLngPoints, soboKmForIdx, (km) =>
							bucketSurface(findRunAtKm(tagRuns, km)?.surface ?? null),
						);
						for (const [bucket, segments] of runsByBucket) {
							if (segments.length === 0) continue;
							const polyline = L.polyline(segments, { ...basePolylineOptions, color: SURFACE_COLORS[bucket] });
							attachPolylineHandlers(polyline);
							featureGroup.addLayer(polyline);
							sectionPolylines.push(polyline);
						}
					} else if (showGradeTinted) {
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
						const currentPaceKmh = packAdjustedPaceKmhFromState(useMapStore.getState());
						const osmTags = useMapStore.getState().trailOsmTagsFile;
						const osmTrailKm = osmTags?.totalKm ?? totalDistanceM / 1000;
						const surfaceBreakdown = osmTags?.runs?.length
							? computeSurfaceBreakdownBySection(osmTags.runs, osmTrailKm)
							: null;

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

							// sectionPts entries are L.LatLng in worker mode and
							// [lat, lng] tuples in the sync fallback; L.latLng
							// normalises both.
							const firstLatLng = L.latLng(sectionPts[0]);
							const lat0 = firstLatLng.lat;
							const lng0 = firstLatLng.lng;
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
								surfaceBreakdown ? surfaceMixForSection(surfaceBreakdown, si) : null,
								(bucket) => tSurfaceBucket(bucket),
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
					const startPoint = L.latLng(latLngPoints[0].lat, latLngPoints[0].lng);
					const finishPoint = L.latLng(
						latLngPoints[latLngPoints.length - 1].lat,
						latLngPoints[latLngPoints.length - 1].lng,
					);

					// Hide the start marker when any colored trail style is shown, so the colored layer is unobstructed.
					if (!showSections && !showGradeTinted && !showSurfaceColoured && !showSacColoured) {
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

					const shareParams = getInitialShareUrlParams();
					if (!shareParamsSkipInitialTrailFitBounds(shareParams)) {
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
		// `trailOsmTagsFile` is gated via `activeOsmTagsFile`: when neither Surface nor SAC is active,
		// the async OSM data load does not invalidate the effect and triggers an avoidable rebuild.
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
		surfaceColoured,
		sacColoured,
		activeOsmTagsFile,
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
		const osmTags = trailOsmTagsFile;
		const osmTrailKm = osmTags?.totalKm ?? meta?.totalDistance ?? 0;
		const surfaceBreakdown = osmTags?.runs?.length ? computeSurfaceBreakdownBySection(osmTags.runs, osmTrailKm) : null;
		for (let i = 0; i < markers.length && i < stats.length; i++) {
			const tooltipHtml = buildSectionTooltipHtml(
				stats[i],
				{ totalDistanceM, totalAscentM, totalDescentM },
				currentUnits,
				currentPrecision,
				t,
				walkingPaceKmh,
				surfaceBreakdown ? surfaceMixForSection(surfaceBreakdown, stats[i].sectionIndex) : null,
				(bucket) => tSurfaceBucket(bucket),
			);
			const tooltip = markers[i].getTooltip();
			if (tooltip) {
				tooltip.setContent(tooltipHtml);
			}
		}
	}, [
		showSections,
		units,
		distancePrecision,
		locale,
		trailMetadata,
		t,
		tSurfaceBucket,
		direction,
		walkingPaceKmh,
		trailOsmTagsFile,
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
