'use client';

/**
 * Renders the CLDT trail polyline, start/finish markers, and trail info tooltip on map click or share URL.
 * Fetches GPX, builds enhanced points (distance/elevation), and syncs with the main store and map store.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import {
	useMapStore,
	useStore,
	type EnhancedTrailPoint,
	type MapStoreState,
	type StoreState,
	type TrailDirection,
} from '@/lib/store';
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

/** Section point groups plus per-section stats for the Sections trail style. */
interface SectionGroups {
	/** One point list per geographic section; empty for sections the route misses. */
	pointGroups: L.LatLng[][];
	/** Stats for each section that produced points, in section order. */
	stats: SectionTooltipStats[];
	totalAscentM: number;
	totalDescentM: number;
}

/**
 * Buckets the route into geographic sections (A/B/C by position along the trail
 * from the SOBO start) and accumulates each section's distance plus its ascent
 * and descent in the direction of travel. Section boundaries are defined in
 * along-trail km, so a NOBO traversal mirrors its cumulative distance back into
 * that space before comparing.
 */
function buildSectionGroups(
	points: L.LatLng[],
	elevationPoints: { elevation: number }[],
	cumDistances: number[],
	direction: TrailDirection,
): SectionGroups {
	const totalDistanceM = cumDistances[cumDistances.length - 1] ?? 0;
	const positionAlongTrailKm = (idx: number): number =>
		direction === 'SOBO' ? cumDistances[idx] / 1000 : (totalDistanceM - cumDistances[idx]) / 1000;
	const sectionAtIdx = (idx: number): number => {
		const trailKm = positionAlongTrailKm(idx);
		const found = TRAIL_SECTIONS.findIndex((s) => trailKm >= s.startKm && trailKm < s.endKm);
		return found >= 0 ? found : TRAIL_SECTIONS.length - 1;
	};

	const pointGroups: L.LatLng[][] = TRAIL_SECTIONS.map(() => []);
	const firstIdx: number[] = new Array(TRAIL_SECTIONS.length).fill(-1);
	const lastIdx: number[] = new Array(TRAIL_SECTIONS.length).fill(-1);
	const ascentM: number[] = new Array(TRAIL_SECTIONS.length).fill(0);
	const descentM: number[] = new Array(TRAIL_SECTIONS.length).fill(0);

	for (let i = 0; i < points.length; i++) {
		const sIdx = sectionAtIdx(i);
		pointGroups[sIdx].push(points[i]);
		if (firstIdx[sIdx] === -1) firstIdx[sIdx] = i;
		lastIdx[sIdx] = i;
		// Share the boundary point with the next section so the two meet visually.
		if (i + 1 < points.length && sectionAtIdx(i + 1) !== sIdx) {
			pointGroups[sIdx].push(points[i + 1]);
		}
		// Attribute a segment's elevation change to the section its start falls in.
		if (i > 0 && elevationPoints[i] && elevationPoints[i - 1]) {
			const elevDiff = elevationPoints[i].elevation - elevationPoints[i - 1].elevation;
			const prevIdx = sectionAtIdx(i - 1);
			if (elevDiff > 0) ascentM[prevIdx] += elevDiff;
			else descentM[prevIdx] += Math.abs(elevDiff);
		}
	}

	const stats: SectionTooltipStats[] = [];
	for (let si = 0; si < TRAIL_SECTIONS.length; si++) {
		if (pointGroups[si].length === 0) continue;
		const fi = firstIdx[si];
		const li = lastIdx[si];
		stats.push({
			startDistM: fi >= 0 ? cumDistances[fi] : 0,
			endDistM: li >= 0 ? cumDistances[li] : 0,
			secDistM: fi >= 0 && li >= 0 ? cumDistances[li] - cumDistances[fi] : 0,
			secAscent: ascentM[si],
			secDescent: descentM[si],
			sectionIndex: si,
		});
	}

	return {
		pointGroups,
		stats,
		totalAscentM: ascentM.reduce((a, b) => a + b, 0),
		totalDescentM: descentM.reduce((a, b) => a + b, 0),
	};
}

/**
 * Everything the render effects need to draw the route, published once per data
 * load. Holding it apart from the raw GPX is what lets a trail-style change
 * redraw from memory instead of re-reading the GPX and re-hydrating the stores.
 */
interface TrailGeometry {
	/** Direction-adjusted route vertices; index 0 is the current travel start.
	 *  Never empty - the loader does not publish a snapshot for an empty route,
	 *  so the renderer can index the ends and take bounds without checking. */
	points: L.LatLng[];
	/** Direction-adjusted elevation triples, parallel to `points`. */
	elevationPoints: { lat: number; lng: number; elevation: number }[];
	/** Cumulative metres from the current start, parallel to `points`. */
	cumDistances: number[];
	/** Enhanced points (per-vertex grade band and percent) for the Grade style. */
	enhanced: EnhancedTrailPoint[];
	/** False when the GPX carries no elevation data, which rules out the Grade style. */
	hasElevation: boolean;
	/** Direction these arrays were built for; the styles index off it, so reading
	 *  it from the snapshot avoids mis-bucketing against a direction whose
	 *  geometry has not landed yet. */
	direction: TrailDirection;
	/** Identity of the load that produced this geometry. The renderer fits the
	 *  viewport once per distinct value, so a redraw of the same load (any style
	 *  change) leaves the view alone. Deliberately excludes `direction`: SOBO and
	 *  NOBO trace the same line, so a flip re-fitting to identical bounds would
	 *  only discard the user's pan and zoom. */
	loadToken: string;
}

/** Trail style actually drawn, after falling through styles whose data is missing. */
type EffectiveTrailStyle = 'sac' | 'surface' | 'grade' | 'sections' | 'default';

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
	/** SVG renderer shared by every route redraw; built lazily by the route render effect. */
	const svgRendererRef = useRef<L.SVG | null>(null);
	const sectionBoundaryMarkersRef = useRef<L.Marker[]>([]);
	const sectionStatsRef = useRef<SectionTooltipStats[]>([]);
	const markerRef = useRef<L.Marker | null>(null);
	const tooltipRef = useRef<L.Tooltip | null>(null);
	const tooltipRootRef = useRef<Root | null>(null);
	const weatherAbortRef = useRef<AbortController | null>(null);
	// One click highlights the trail through three paths (direct click handler,
	// the `trailPositionHighlighted` event, and the highlightedPoint effect),
	// each of which re-renders the tooltip. This caches the in-flight weather
	// request per coordinate so those paths share a single fetch instead of
	// firing and aborting three. Cleared when the tooltip is torn down.
	const weatherCacheRef = useRef<{ key: string; promise: Promise<WeatherData | null> } | null>(null);
	const startMarkerRef = useRef<L.Marker | null>(null);
	const finishMarkerRef = useRef<L.Marker | null>(null);
	const [isTooltipVisible, setIsTooltipVisible] = useState(false);
	const showMarkerAtPositionRef = useRef<(point: TrailPoint) => void>(() => {});
	const clearMarkerAndTooltipRef = useRef<() => void>(() => {});
	const isTooltipPinnedByClickRef = useRef(false);
	const lastRouteClickTimeRef = useRef(0);
	/** Route geometry from the most recent data load; drives both render effects. */
	const [geometry, setGeometry] = useState<TrailGeometry | null>(null);
	/** Load token the viewport was last fitted for; see `TrailGeometry.loadToken`. */
	const fittedTokenRef = useRef<string | null>(null);

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
	const walkingPaceKmh = usePackAdjustedPaceKmh();

	const tagRuns = trailOsmTagsFile?.runs ?? null;
	const hasTagRuns = tagRuns !== null && tagRuns.length > 0;
	// Style priority: sac > surface > grade > sections > default. Surface and SAC
	// need the OSM tag dataset and Grade needs elevation; a selection whose data is
	// missing falls through to the next style rather than rendering nothing.
	// Deriving one value keeps the render effects off the four raw flags, so a
	// selection that changes nothing visible (picking Surface with no tag data)
	// no longer redraws.
	const effectiveTrailStyle: EffectiveTrailStyle =
		sacColoured && hasTagRuns
			? 'sac'
			: surfaceColoured && hasTagRuns
				? 'surface'
				: gradeTintedTrail && (geometry?.hasElevation ?? false)
					? 'grade'
					: showSections
						? 'sections'
						: 'default';
	// Only the two OSM-tag styles read the dataset, so gate the render effect's
	// dependency on it: tag data arriving under any other style must not redraw.
	const styleTagRuns = effectiveTrailStyle === 'sac' || effectiveTrailStyle === 'surface' ? tagRuns : null;
	// The start flag would sit on top of the coloured layer it is meant to show off.
	const startFlagVisible = effectiveTrailStyle === 'default';

	const highlightedPoint = useStore((state: StoreState) => state.highlightedTrailPoint);
	const tooltipPinnedFromShare = useStore((state: StoreState) => state.tooltipPinnedFromShare);
	const highlightTrailPosition = useStore((state: StoreState) => state.highlightTrailPosition);
	const clearTrailHighlight = useStore((state: StoreState) => state.clearTrailHighlight);
	const trailMetadata = useStore((state: StoreState) => state.trailMetadata);

	const setRawGpxData = useMapStore((state: MapStoreState) => state.setRawGpxData);
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
		// Drop the per-coordinate weather cache so reopening this point later
		// fetches fresh weather instead of reusing a stale resolved request.
		weatherCacheRef.current = null;
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

	/**
	 * Returns a renderer for one batch of section-boundary tooltips. Shared by the
	 * sections render branch and the tooltip-refresh effect so the OSM tag read, the
	 * surface breakdown and the bucket-label closure live in a single place. The
	 * breakdown is a full run-scan and is loop-invariant, so it is computed once per
	 * batch here rather than once per section. `totals` is a parameter because the
	 * two callers source it differently (geometry-derived at render time, the trail
	 * metadata on refresh). Units, precision and pace are parameters rather than
	 * subscriptions - and the tag dataset is read imperatively - so that this
	 * callback's identity does not pull any of them into the route render effect's
	 * dependencies, where a change would redraw every polyline.
	 */
	const makeSectionTooltipRenderer = useCallback(() => {
		const osmTags = useMapStore.getState().trailOsmTagsFile;
		const surfaceBreakdown = osmTags?.runs?.length
			? computeSurfaceBreakdownBySection(osmTags.runs, osmTags.totalKm)
			: null;
		return (
			stat: SectionTooltipStats,
			totals: { totalDistanceM: number; totalAscentM: number; totalDescentM: number },
			unitSystem: UnitSystem,
			precision: number,
			paceKmh: number,
		): string =>
			buildSectionTooltipHtml(
				stat,
				totals,
				unitSystem,
				precision,
				t,
				paceKmh,
				surfaceBreakdown ? surfaceMixForSection(surfaceBreakdown, stat.sectionIndex) : null,
				(bucket) => tSurfaceBucket(bucket),
			);
	}, [t, tSurfaceBucket]);

	/** Tears down the style-dependent layers: route polylines and section chips. */
	const removeRouteLayer = useCallback((): void => {
		if (!map) return;
		if (routeLayerRef.current) {
			routeLayerRef.current.removeFrom(map);
			routeLayerRef.current = null;
		}
		for (const m of sectionBoundaryMarkersRef.current) {
			m.removeFrom(map);
		}
		sectionBoundaryMarkersRef.current = [];
		sectionStatsRef.current = [];
	}, [map]);

	/** Removes whichever endpoint flag the given ref holds, if any. */
	const removeEndpointMarker = useCallback(
		(ref: React.MutableRefObject<L.Marker | null>): void => {
			if (!map) return;
			if (ref.current) {
				ref.current.removeFrom(map);
				ref.current = null;
			}
		},
		[map],
	);

	/** Builds one endpoint flag and puts it on the map. */
	const addEndpointMarker = useCallback(
		(position: L.LatLng, className: string, svg: string, label: string): L.Marker => {
			const marker = L.marker(position, {
				icon: L.divIcon({
					className: `trail-endpoint-marker ${className}`,
					html: `<div class="trail-endpoint-marker-inner">${svg}</div>`,
					iconSize: [28, 28],
					iconAnchor: [14, 14],
				}),
				zIndexOffset: 100,
			});
			marker.bindTooltip(label, {
				direction: 'top',
				permanent: false,
				className: 'map-tooltip map-tooltip--compact',
			});
			// The icon element only exists once the marker is on the map.
			marker.on('add', () => {
				const el =
					(marker as L.Marker & { getElement?: () => HTMLElement }).getElement?.() ??
					(marker as unknown as { _icon?: HTMLElement })._icon;
				if (el) el.setAttribute('aria-label', label);
			});
			marker.addTo(map);
			return marker;
		},
		[map],
	);

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
			// Reuse the in-flight (or just-resolved) weather request when the same
			// point is shown again within one tooltip session - the three highlight
			// paths fire in the same tick, and a units/precision change re-renders
			// the open tooltip without needing fresh weather. Only start (and abort
			// the previous) when the target coordinate actually changes.
			const weatherKey = `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
			let weatherCache = weatherCacheRef.current;
			if (weatherCache?.key !== weatherKey) {
				weatherAbortRef.current?.abort();
				const weatherAbort = new AbortController();
				weatherAbortRef.current = weatherAbort;
				weatherCache = { key: weatherKey, promise: fetchWeather(point.lat, point.lng, weatherAbort.signal) };
				weatherCacheRef.current = weatherCache;
			}
			const activeAbort = weatherAbortRef.current;
			void weatherCache.promise.then((weatherData) => {
				if (activeAbort?.signal.aborted) return;
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

	// Data: fetch the GPX, hydrate both stores, and publish the geometry snapshot
	// the render effects draw from. Carries no style input by design, so changing
	// the trail style never re-reads the GPX nor re-hydrates the stores - which
	// would republish trailPoints / enhancedTrailPoints / gpxElevationPoints under
	// fresh identities and cascade through every subscriber of them.
	useEffect(() => {
		if (!map) {
			return;
		}

		let isMounted = true;

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

				let points: L.LatLng[];
				let cumDistances: number[];
				let hasElevation: boolean;
				let elevationPoints: { lat: number; lng: number; elevation: number }[];

				if (workerData && workerData.points.length > 0) {
					// Worker output is already direction-adjusted; the only
					// main-thread loops left are cheap materialisations.
					useStore.getState().applyComputedTrailData?.(workerData);
					// Borrow the main store's trailPoints instead of building a second
					// L.LatLng array over the same ~100k coordinates: applyComputedTrailData
					// has just materialised exactly this list, and zustand's set is
					// synchronous so it is readable in the same tick. It writes trailPoints
					// and enhancedTrailPoints in one set(), so seeing our own `enhanced`
					// object in the store proves this specific hydration landed and the
					// array can be borrowed rather than rebuilt. Comparing lengths would
					// not: a SOBO<->NOBO flip yields the same vertex count, so a stale
					// array from the previous load would pass. The fallback covers the
					// case where the store declined the write.
					const hydrated = useStore.getState();
					points =
						hydrated.enhancedTrailPoints === workerData.enhanced
							? hydrated.trailPoints
							: workerData.points.map((p) => L.latLng(p.lat, p.lng));
					cumDistances = workerData.enhanced.map((p) => p.distanceFromStart);
					hasElevation = workerData.hasElevation;
					elevationPoints = workerData.elevationPoints;

					processTrailData?.(
						points,
						elevationPoints,
						points[0] ?? null,
						points[points.length - 1] ?? null,
						workerData.metadata.totalDistanceM / 1000,
						workerData.metadata.elevationGain,
						workerData.metadata.elevationLoss,
					);
				} else {
					const parsed = parseGpx(result.data);
					const trackPts = parsed.tracks[0]?.points ?? [];
					hasElevation = trackPts.some((p) => p.ele !== undefined && p.ele !== null);
					const ordered = direction === 'NOBO' ? [...trackPts].reverse() : trackPts;
					points = ordered.map(({ lat, lng }) => L.latLng(lat, lng));
					elevationPoints = ordered.map(({ lat, lng, ele }) => ({ lat, lng, elevation: ele ?? 0 }));

					// Cumulative distances drive the section split and the OSM tag lookup.
					cumDistances = [0];
					let cumDistM = 0;
					for (let i = 1; i < points.length; i++) {
						cumDistM += points[i - 1].distanceTo(points[i]);
						cumDistances.push(cumDistM);
					}

					if (points.length > 0) {
						// Enrich early so `enhancedTrailPoints` (with gradeBand/gradePct) is in the
						// store before the grade-tinted render branch consumes it. Both stores hold
						// parallel trail state; their enrichment actions are independent and each
						// must be invoked.
						const computedMetadata = calculateTrailMetadata(points, elevationPoints);
						const processArgs = [
							points,
							elevationPoints,
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

				if (!isMounted || points.length === 0) {
					return;
				}

				setGeometry({
					points,
					elevationPoints,
					cumDistances,
					// Populated by the hydration calls above, in either branch.
					enhanced: useStore.getState().enhancedTrailPoints,
					hasElevation,
					direction,
					loadToken: `${selectedTrail ?? ''}:${reloadTrailRequested}`,
				});

				if (setGpxLoaded) {
					setGpxLoaded(true);
				}
			} catch (error) {
				console.error('Error loading GPX trail:', error);
				if (setGpxLoadFailed) {
					setGpxLoadFailed(true);
				}
			}
		};

		void loadGpxData();

		return () => {
			isMounted = false;
		};
	}, [
		map,
		selectedTrail,
		direction,
		reloadTrailRequested,
		setRawGpxData,
		setGpxLoaded,
		setGpxLoadFailed,
		processTrailData,
	]);

	// Route polylines and section boundary chips for the active style. Keyed on the
	// geometry snapshot, so a style change redraws from data already in memory.
	useEffect(() => {
		if (!map || !geometry) {
			return;
		}

		const { points, elevationPoints, cumDistances, enhanced, direction: geometryDirection } = geometry;
		const featureGroup = L.featureGroup();
		// Shared SVG renderer and base polyline options for all render branches.
		// One renderer is reused across redraws instead of being built per redraw:
		// Leaflet adds a renderer to the map as a layer the first time a path using
		// it is drawn, and tearing down the route FeatureGroup only detaches the
		// paths - the renderer layer itself stays on the map, so its onRemove (which
		// destroys the <svg> container and unbinds the viewreset / zoom / zoomanim /
		// moveend / zoomend handlers) never fires. A per-redraw renderer would
		// therefore leak one orphaned container plus a live handler set per style
		// change. Built lazily here because it is only needed once geometry exists;
		// it is removed from the map by the renderer-lifetime effect below.
		svgRendererRef.current ??= L.svg({ padding: 10 });
		const svgRenderer = svgRendererRef.current;
		const basePolylineOptions: L.PolylineOptions = {
			...pathOptions,
			smoothFactor: 1,
			interactive: true,
			bubblingMouseEvents: true,
			weight: pathOptions.weight || 5,
			renderer: svgRenderer,
		};

		/** Adds one route polyline with click wiring. The array-of-arrays form is the
		 *  MultiLineString case: L.polyline draws grouped runs (grade bands, tag bands,
		 *  section groups) as one layer. */
		const addPolyline = (latlngs: L.LatLng[] | L.LatLng[][], color?: string): void => {
			const polyline = L.polyline(latlngs, color ? { ...basePolylineOptions, color } : basePolylineOptions);
			polyline.on('click', (e) => {
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
					// Show the marker/tooltip immediately so it appears without needing to move the cursor.
					const point = useStore.getState().highlightedTrailPoint;
					if (point) {
						showMarkerAtPositionRef.current(point);
					}
				}
			});
			featureGroup.addLayer(polyline);
		};

		// SOBO-direction km lookup: the OSM tag dataset is direction-agnostic
		// (always indexed from the SOBO start), so when the user traverses NOBO,
		// we mirror the cum-distance back to SOBO space before binary-searching.
		const totalDistanceM = cumDistances[cumDistances.length - 1];
		const soboKmForIdx = (idx: number): number =>
			geometryDirection === 'SOBO' ? cumDistances[idx] / 1000 : (totalDistanceM - cumDistances[idx]) / 1000;

		if (effectiveTrailStyle === 'sac' && styleTagRuns) {
			const runsByBucket = buildTagBandSegments<SacBucket>(points, soboKmForIdx, (km) =>
				bucketSac(findRunAtKm(styleTagRuns, km)?.sac_scale ?? null),
			);
			for (const [bucket, segments] of runsByBucket) {
				if (segments.length > 0) addPolyline(segments, SAC_COLORS[bucket]);
			}
		} else if (effectiveTrailStyle === 'surface' && styleTagRuns) {
			const runsByBucket = buildTagBandSegments<SurfaceBucket>(points, soboKmForIdx, (km) =>
				bucketSurface(findRunAtKm(styleTagRuns, km)?.surface ?? null),
			);
			for (const [bucket, segments] of runsByBucket) {
				if (segments.length > 0) addPolyline(segments, SURFACE_COLORS[bucket]);
			}
		} else if (effectiveTrailStyle === 'grade') {
			const runs = buildGradeBandSegments(enhanced, points);
			for (let band = 0; band < 5; band++) {
				for (let sign = 0; sign < 2; sign++) {
					const segments = runs[band][sign];
					if (segments.length === 0) continue;
					const color =
						sign === 0
							? GRADE_BAND_ASCENT_COLORS[band as 0 | 1 | 2 | 3 | 4]
							: GRADE_BAND_DESCENT_COLORS[band as 0 | 1 | 2 | 3 | 4];
					addPolyline(segments, color);
				}
			}
		} else if (effectiveTrailStyle === 'sections') {
			const groups = buildSectionGroups(points, elevationPoints, cumDistances, geometryDirection);
			const currentUnits = useMapStore.getState().units;
			const currentPrecision = useMapStore.getState().distancePrecision;
			const currentPaceKmh = packAdjustedPaceKmhFromState(useMapStore.getState());
			const totals = {
				totalDistanceM,
				totalAscentM: groups.totalAscentM,
				totalDescentM: groups.totalDescentM,
			};
			const newSectionMarkers: L.Marker[] = [];
			const renderSectionTooltip = makeSectionTooltipRenderer();

			// Draw each geographic section with its own label and color (A=green, B=blue, C=red by position along the trail).
			for (const stat of groups.stats) {
				const section = TRAIL_SECTIONS[stat.sectionIndex];
				const sectionPts = groups.pointGroups[stat.sectionIndex];
				addPolyline(sectionPts, section.color);

				const marker = L.marker(sectionPts[0], {
					icon: sectionBoundaryIcon(section.shortName, stat.sectionIndex),
					zIndexOffset: 50,
				});
				marker.bindTooltip(renderSectionTooltip(stat, totals, currentUnits, currentPrecision, currentPaceKmh), {
					direction: 'top',
					permanent: false,
					className: 'map-tooltip map-tooltip--section',
				});
				marker.addTo(map);
				newSectionMarkers.push(marker);
			}
			sectionBoundaryMarkersRef.current = newSectionMarkers;
			sectionStatsRef.current = groups.stats;
		} else {
			// No style-specific colouring: a single default-coloured polyline.
			addPolyline(points);
		}

		featureGroup.addTo(map);
		routeLayerRef.current = featureGroup;

		// Fit the viewport once per load (see TrailGeometry.loadToken), so a style
		// change redraws inside whatever view the user is currently on. Mark the
		// token consumed even when a share link suppresses the fit, otherwise the
		// next redraw would claim it and yank the map away from the linked target.
		if (fittedTokenRef.current !== geometry.loadToken) {
			fittedTokenRef.current = geometry.loadToken;
			if (!shareParamsSkipInitialTrailFitBounds(getInitialShareUrlParams())) {
				map.fitBounds(featureGroup.getBounds(), { padding: [50, 50] });
			}
		}

		return () => {
			removeRouteLayer();
		};
		// pathOptions is intentionally omitted: it is a module-level constant by default; including
		// it would redraw the route on every parent render if a caller ever passed an inline object.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		map,
		geometry,
		effectiveTrailStyle,
		styleTagRuns,
		removeRouteLayer,
		highlightTrailPosition,
		makeSectionTooltipRenderer,
	]);

	// The shared SVG renderer outlives every redraw, so its teardown belongs to the
	// map's lifetime rather than to the per-redraw cleanup - removing it alongside the
	// route layer would defeat the point of sharing it. Declared after the route render
	// effect so on unmount the polylines are detached before the renderer goes.
	useEffect(
		() => () => {
			if (svgRendererRef.current) {
				svgRendererRef.current.removeFrom(map);
				svgRendererRef.current = null;
			}
		},
		[map],
	);

	// Finish flag. Its presence does not depend on the trail style, so it is kept in
	// its own effect: a style change must not destroy and rebuild it, which would
	// close any tooltip the user has open on it.
	useEffect(() => {
		if (!map || !geometry) {
			return;
		}

		const { points, direction: geometryDirection } = geometry;
		const directionText = geometryDirection === 'SOBO' ? tChart('directionNorthSouth') : tChart('directionSouthNorth');

		finishMarkerRef.current = addEndpointMarker(
			points[points.length - 1],
			'trail-finish-marker',
			FINISH_FLAG_SVG,
			t('finishPoint', { direction: directionText }),
		);

		return () => {
			removeEndpointMarker(finishMarkerRef);
		};
	}, [map, geometry, addEndpointMarker, removeEndpointMarker, t, tChart]);

	// Start flag, drawn only under the default style (it would otherwise sit on top
	// of the coloured layer it is meant to show off). Separate from the finish flag
	// so a style toggle rebuilds only the marker whose visibility actually changed.
	useEffect(() => {
		if (!map || !geometry || !startFlagVisible) {
			return;
		}

		const { points, direction: geometryDirection } = geometry;
		const directionText = geometryDirection === 'SOBO' ? tChart('directionNorthSouth') : tChart('directionSouthNorth');

		startMarkerRef.current = addEndpointMarker(
			points[0],
			'trail-start-marker',
			START_FLAG_SVG,
			t('startingPoint', { direction: directionText }),
		);

		return () => {
			removeEndpointMarker(startMarkerRef);
		};
	}, [map, geometry, startFlagVisible, addEndpointMarker, removeEndpointMarker, t, tChart]);

	// Map click dismissal plus the highlight events the chart and scrubber fire.
	// Independent of the data load and of the active style, so changing style no
	// longer tears down an open trail tooltip or aborts its in-flight weather fetch.
	useEffect(() => {
		if (!map) {
			return;
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

		map.on('click', handleMapClick);
		window.addEventListener('trailPositionHighlighted', handlePositionHighlighted as EventListener);
		window.addEventListener('trailHighlightCleared', handleHighlightCleared);

		return () => {
			map.off('click', handleMapClick);
			window.removeEventListener('trailPositionHighlighted', handlePositionHighlighted as EventListener);
			window.removeEventListener('trailHighlightCleared', handleHighlightCleared);
			clearMarkerAndTooltipRef.current();
		};
	}, [map, clearTrailHighlight]);

	// Update section boundary tooltips when units, precision, or locale change.
	useEffect(() => {
		if (
			effectiveTrailStyle !== 'sections' ||
			sectionBoundaryMarkersRef.current.length === 0 ||
			sectionStatsRef.current.length === 0
		) {
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
		const renderSectionTooltip = makeSectionTooltipRenderer();
		for (let i = 0; i < markers.length && i < stats.length; i++) {
			const tooltipHtml = renderSectionTooltip(
				stats[i],
				{ totalDistanceM, totalAscentM, totalDescentM },
				currentUnits,
				currentPrecision,
				walkingPaceKmh,
			);
			const tooltip = markers[i].getTooltip();
			if (tooltip) {
				tooltip.setContent(tooltipHtml);
			}
		}
		// `trailOsmTagsFile` is a deliberate re-run trigger rather than a value this
		// effect reads: the renderer reads the dataset imperatively (to keep it out of
		// the route render effect's dependencies), so this subscription is what makes
		// the open tooltips pick up tag data that lands after they were built.
	}, [
		effectiveTrailStyle,
		units,
		distancePrecision,
		locale,
		trailMetadata,
		makeSectionTooltipRenderer,
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
