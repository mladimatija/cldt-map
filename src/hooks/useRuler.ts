'use client';

/**
 * Distance-ruler state machine for the trail map, extracted from MapControls.
 *
 * Owns everything ruler: Leaflet panes, point markers, the dashed connector,
 * the on-trail segment highlight, the permanent tooltip (with elevation
 * gain/loss), click capture, the elevation-chart drag bridge, direction-flip
 * range conversion, Escape-to-close, and the aria-live announcement.
 *
 * The host component only consumes the returned surface: button state
 * (isRulerEnabled, toggleRuler), the active range for export/share flows
 * (rulerRange), and the announcement node text (rulerAnnouncement).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { useTranslations } from 'next-intl';
import { calculateTrailMetadata } from '@/lib/map';
import { findNearestPointIndex } from '@/lib/distance-utils';
import { type EnhancedTrailPoint, type MapStoreState, type StoreState, useMapStore, useStore } from '@/lib/store';
import { formatDistance, formatElevation } from '@/lib/utils';
import { fitMapToRulerBounds } from '@/lib/export-utils';
import { RULER_SET_FROM_CHART_EVENT, type RulerSetFromChartDetail } from '@/lib/ruler-from-chart';
import { usePanelManager } from './usePanelManager';

type RulerRange = NonNullable<MapStoreState['rulerRange']>;
type UnitSystem = MapStoreState['units'];
type TrailDirection = MapStoreState['direction'];

const RULER_MARKER_ICON = L.divIcon({
	className: 'ruler-point',
	html: '<div class="w-3 h-3 bg-(--cldt-blue) rounded-full"></div>',
	iconSize: [12, 12],
	iconAnchor: [6, 6],
});

/**
 * Pane name for ruler polylines; z-index above overlay so ruler always draws on top of the trail.
 * We use this instead of leaflet's bringToFront() because it only reorders inside one pane and
 * can't reliably beat the trail when the trail is re-added later; a higher-z-index pane makes
 * the ruler always on top regardless of add order.
 */
const RULER_PANE = 'rulerPane';
/** Pane for ruler point markers (blue dots); above ruler line, below tooltips. */
const RULER_MARKERS_PANE = 'rulerMarkersPane';
/** Pane for ruler tooltip; above ruler line and markers, below trail point tooltip. */
const RULER_TOOLTIP_PANE = 'rulerTooltipPane';

const RULER_MARKER_OPTIONS: L.MarkerOptions = { icon: RULER_MARKER_ICON, pane: RULER_MARKERS_PANE };

const RULER_POLYLINE_OPTIONS: L.PolylineOptions = {
	pane: RULER_PANE,
	color: 'var(--cldt-blue)',
	weight: 3,
	opacity: 0.7,
	dashArray: '5, 10',
};

function findPointAtDistance(enhancedTrailPoints: EnhancedTrailPoint[], distanceM: number): EnhancedTrailPoint | null {
	if (enhancedTrailPoints.length === 0) return null;
	return enhancedTrailPoints[findNearestPointIndex(enhancedTrailPoints, distanceM)];
}

type RulerPointData = { latlng: L.LatLng; distanceFromStart: number };

type RulerSegmentOpts = {
	units: UnitSystem;
	distancePrecision: number;
	t: (k: string) => string;
	tChart: (k: string) => string;
};

export interface UseRulerResult {
	isRulerEnabled: boolean;
	rulerRange: RulerRange | null;
	/** Screen-reader announcement for the enable/disable toggle; render in an aria-live region. */
	rulerAnnouncement: string | null;
	toggleRuler: () => void;
}

export function useRuler(map: L.Map): UseRulerResult {
	const t = useTranslations('mapControls');
	const tChart = useTranslations('elevationChart');
	const { openPanel: openPanelId, close: closePanel } = usePanelManager();

	const isRulerEnabled = useMapStore((state: MapStoreState) => state.isRulerEnabled);
	const setRulerEnabled = useMapStore((state: MapStoreState) => state.setRulerEnabled);
	const rulerRange = useMapStore((state: MapStoreState) => state.rulerRange);
	const setRulerRange = useMapStore((state: MapStoreState) => state.setRulerRange);
	const units = useMapStore((state: MapStoreState) => state.units);
	const distancePrecision = useMapStore((state: MapStoreState) => state.distancePrecision);
	const direction = useMapStore((state: MapStoreState) => state.direction);
	const enhancedTrailPoints = useStore((state: StoreState) => state.enhancedTrailPoints);

	const rulerLayerRef = useRef<L.Polyline | null>(null);
	const rulerMarkerRef = useRef<L.Marker[]>([]);
	const rulerTooltipRef = useRef<L.Tooltip | null>(null);
	const rulerPointDataRef = useRef<RulerPointData[]>([]);
	const rulerSegmentHighlightRef = useRef<L.Polyline | null>(null);
	const rulerClickHandlerRef = useRef<(e: L.LeafletMouseEvent) => void>(() => {});
	const lastDirectionRef = useRef<TrailDirection | undefined>(undefined);

	const stableRulerClick = useCallback((e: L.LeafletMouseEvent) => {
		rulerClickHandlerRef.current(e);
	}, []);

	// Escape closes the ruler only when no overlay panel is currently open -
	// panel-driven Escape is handled inside usePanelManager.
	useEffect(() => {
		if (!isRulerEnabled || openPanelId) return;
		const handle = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') setRulerEnabled(false);
		};
		document.addEventListener('keydown', handle);
		return () => document.removeEventListener('keydown', handle);
	}, [isRulerEnabled, openPanelId, setRulerEnabled]);

	// Ruler panes: order set in map.css (ruler-pane, ruler-markers-pane, ruler-tooltip-pane).
	useEffect(() => {
		if (!map.getPane(RULER_PANE)) {
			map.createPane(RULER_PANE);
			const pane = map.getPane(RULER_PANE);
			if (pane) pane.classList.add('ruler-pane');
		}
		if (!map.getPane(RULER_MARKERS_PANE)) {
			map.createPane(RULER_MARKERS_PANE);
			const pane = map.getPane(RULER_MARKERS_PANE);
			if (pane) pane.classList.add('ruler-markers-pane');
		}
		if (!map.getPane(RULER_TOOLTIP_PANE)) {
			map.createPane(RULER_TOOLTIP_PANE);
			const pane = map.getPane(RULER_TOOLTIP_PANE);
			if (pane) pane.classList.add('ruler-tooltip-pane');
		}
	}, [map]);

	const clearRulerMarkersAndLayers = useCallback((): void => {
		rulerMarkerRef.current.forEach((m) => map.removeLayer(m));
		rulerMarkerRef.current = [];
		rulerPointDataRef.current = [];
		if (rulerTooltipRef.current) {
			map.removeLayer(rulerTooltipRef.current);
			rulerTooltipRef.current = null;
		}
		if (rulerLayerRef.current) {
			map.removeLayer(rulerLayerRef.current);
			rulerLayerRef.current = null;
		}
		if (rulerSegmentHighlightRef.current) {
			map.removeLayer(rulerSegmentHighlightRef.current);
			rulerSegmentHighlightRef.current = null;
		}
	}, [map]);

	const buildRulerSegmentAndTooltipContent = useCallback(
		(
			dataA: RulerPointData,
			dataB: RulerPointData,
			trailPoints: EnhancedTrailPoint[] | null,
			points: [L.LatLng, L.LatLng],
			opts: RulerSegmentOpts,
		) => {
			const hasTrail = trailPoints && trailPoints.length > 0;
			const distA = dataA.distanceFromStart;
			const distB = dataB.distanceFromStart;
			const distanceBetween = hasTrail ? Math.abs(distB - distA) : calculateTrailMetadata(points).totalDistance;
			const minDist = Math.min(distA, distB);
			const maxDist = Math.max(distA, distB);
			const segment =
				hasTrail && trailPoints
					? trailPoints
							.filter(
								(p: EnhancedTrailPoint) => p.distanceFromStart >= minDist - 0.1 && p.distanceFromStart <= maxDist + 0.1,
							)
							.sort((a: EnhancedTrailPoint, b: EnhancedTrailPoint) => a.distanceFromStart - b.distanceFromStart)
					: [];
			const elevationGain =
				segment.length >= 2
					? segment[segment.length - 1].elevationGainFromStart - segment[0].elevationGainFromStart
					: 0;
			const elevationLoss =
				segment.length >= 2
					? segment[segment.length - 1].elevationLossFromStart - segment[0].elevationLossFromStart
					: 0;
			const fmt = (meters: number): string => formatDistance(meters / 1000, opts.units, opts.distancePrecision, false);
			const elevationLines =
				segment.length >= 2
					? `<div>${opts.tChart('gain')}: ${formatElevation(elevationGain, opts.units)}</div><div>${opts.tChart('loss')}: ${formatElevation(elevationLoss, opts.units)}</div>`
					: '';
			const content = `<div class="distance-tooltip-content">
                <div>${opts.t('pointA')}: ${fmt(distA)}</div>
                <div>${opts.t('pointB')}: ${fmt(distB)}</div>
                <div><strong>${opts.t('rulerDistance')}: ${fmt(distanceBetween)}</strong></div>
                ${elevationLines}
            </div>`;
			const midPoint = L.latLng((points[0].lat + points[1].lat) / 2, (points[0].lng + points[1].lng) / 2);
			const segmentPoints = segment.length >= 2 ? segment.map((p: EnhancedTrailPoint) => L.latLng(p.lat, p.lng)) : [];
			return { content, midPoint, segmentPoints };
		},
		[],
	);

	const applyRulerSegmentAndTooltip = useCallback(
		(
			dataA: RulerPointData,
			dataB: RulerPointData,
			trailPoints: EnhancedTrailPoint[] | null,
			points: [L.LatLng, L.LatLng],
			optsOverride?: RulerSegmentOpts,
		): void => {
			if (rulerTooltipRef.current) {
				map.removeLayer(rulerTooltipRef.current);
				rulerTooltipRef.current = null;
			}
			if (rulerSegmentHighlightRef.current) {
				map.removeLayer(rulerSegmentHighlightRef.current);
				rulerSegmentHighlightRef.current = null;
			}
			const opts: RulerSegmentOpts = optsOverride ?? {
				units: units,
				distancePrecision: distancePrecision,
				t,
				tChart,
			};
			const { content, midPoint, segmentPoints } = buildRulerSegmentAndTooltipContent(
				dataA,
				dataB,
				trailPoints,
				points,
				opts,
			);
			rulerTooltipRef.current = L.tooltip({
				pane: RULER_TOOLTIP_PANE,
				permanent: true,
				direction: 'top',
				offset: L.point(0, -60),
				className: 'map-tooltip',
			})
				.setLatLng(midPoint)
				.setContent(content)
				.addTo(map);
			if (segmentPoints.length >= 2) {
				rulerSegmentHighlightRef.current = L.polyline(segmentPoints, {
					pane: RULER_PANE,
					color: 'var(--cldt-blue)',
					weight: 5,
				}).addTo(map);
			}
		},
		[units, distancePrecision, t, tChart, buildRulerSegmentAndTooltipContent, map],
	);

	const [rulerAnnouncement, setRulerAnnouncement] = useState<string | null>(null);
	const rulerAnnouncementTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const toggleRuler = useCallback((): void => {
		closePanel();
		const willBeEnabled = !useMapStore.getState().isRulerEnabled;
		setRulerEnabled(willBeEnabled);
		const msg = willBeEnabled ? t('rulerEnable') : t('rulerDisable');
		if (rulerAnnouncementTimeoutRef.current) clearTimeout(rulerAnnouncementTimeoutRef.current);
		setRulerAnnouncement(msg);
		rulerAnnouncementTimeoutRef.current = setTimeout(() => {
			setRulerAnnouncement(null);
			rulerAnnouncementTimeoutRef.current = null;
		}, 1000);
	}, [closePanel, setRulerEnabled, t]);

	useEffect(
		() => () => {
			if (rulerAnnouncementTimeoutRef.current) clearTimeout(rulerAnnouncementTimeoutRef.current);
		},
		[],
	);

	// Keep the map click handler in sync with the ruler state (store).
	useEffect(() => {
		map.off('click', stableRulerClick);
		if (isRulerEnabled) {
			map.on('click', stableRulerClick);
			return;
		}
		clearRulerMarkersAndLayers();
		setRulerRange(null);
	}, [isRulerEnabled, map, clearRulerMarkersAndLayers, setRulerRange, stableRulerClick]);

	// When trail direction changes and ruler is active, convert ruler range so the same segment uses the new direction's distance-from-start.
	useEffect(() => {
		if (!isRulerEnabled || !rulerRange || !enhancedTrailPoints?.length) {
			lastDirectionRef.current = direction;
			return;
		}
		if (lastDirectionRef.current !== undefined && lastDirectionRef.current !== direction) {
			const totalM = enhancedTrailPoints[enhancedTrailPoints.length - 1]?.distanceFromStart ?? 0;
			setRulerRange({
				distanceFromStartA: totalM - rulerRange.distanceFromStartB,
				distanceFromStartB: totalM - rulerRange.distanceFromStartA,
			});
		}
		lastDirectionRef.current = direction;
	}, [direction, isRulerEnabled, rulerRange, enhancedTrailPoints, setRulerRange]);

	// When trail data (e.g., after direction change) updates and ruler is active, rebuild the ruler from the current store range.
	useEffect(() => {
		if (!isRulerEnabled || !enhancedTrailPoints?.length || !rulerRange) return;

		const pointA = findPointAtDistance(enhancedTrailPoints, rulerRange.distanceFromStartA);
		const pointB = findPointAtDistance(enhancedTrailPoints, rulerRange.distanceFromStartB);
		if (!pointA || !pointB) return;

		clearRulerMarkersAndLayers();

		const latLngA = L.latLng(pointA.lat, pointA.lng);
		const latLngB = L.latLng(pointB.lat, pointB.lng);
		const marker1 = L.marker(latLngA, RULER_MARKER_OPTIONS).addTo(map);
		const marker2 = L.marker(latLngB, RULER_MARKER_OPTIONS).addTo(map);
		rulerMarkerRef.current = [marker1, marker2];
		rulerPointDataRef.current = [
			{ latlng: latLngA, distanceFromStart: pointA.distanceFromStart },
			{ latlng: latLngB, distanceFromStart: pointB.distanceFromStart },
		];

		const points: [L.LatLng, L.LatLng] = [latLngA, latLngB];
		rulerLayerRef.current = L.polyline(points, RULER_POLYLINE_OPTIONS).addTo(map);

		const opts: RulerSegmentOpts = {
			units: units,
			distancePrecision: distancePrecision,
			t,
			tChart,
		};
		applyRulerSegmentAndTooltip(
			rulerPointDataRef.current[0],
			rulerPointDataRef.current[1],
			enhancedTrailPoints,
			points,
			opts,
		);
	}, [
		isRulerEnabled,
		rulerRange,
		enhancedTrailPoints,
		units,
		distancePrecision,
		map,
		t,
		tChart,
		clearRulerMarkersAndLayers,
		applyRulerSegmentAndTooltip,
	]);

	// Auto-zoom map to the ruler segment whenever the range is set or updated.
	useEffect(() => {
		if (!rulerRange) return;
		const points = useStore.getState().enhancedTrailPoints;
		if (!points?.length) return;
		fitMapToRulerBounds(map, rulerRange, points);
	}, [rulerRange, map]);

	// Keep the click handler ref in sync with the latest closure on every render.
	useLayoutEffect(() => {
		rulerClickHandlerRef.current = (e: L.LeafletMouseEvent): void => {
			const { latlng } = e;

			const trailPoints = useStore.getState().enhancedTrailPoints;
			let resolvedLatLng = latlng;
			let distanceFromStart = 0;

			if (trailPoints && trailPoints.length > 0) {
				let closest = trailPoints[0];
				let minDist = L.latLng(closest.lat, closest.lng).distanceTo(latlng);
				for (let i = 1; i < trailPoints.length; i++) {
					const p = trailPoints[i];
					const d = L.latLng(p.lat, p.lng).distanceTo(latlng);
					if (d < minDist) {
						minDist = d;
						closest = p;
					}
				}
				resolvedLatLng = L.latLng(closest.lat, closest.lng);
				distanceFromStart = closest.distanceFromStart;
			}

			if (rulerMarkerRef.current.length >= 2) {
				clearRulerMarkersAndLayers();
				setRulerRange(null);
			}

			const marker = L.marker(resolvedLatLng, RULER_MARKER_OPTIONS).addTo(map);

			const pointData = { latlng: resolvedLatLng, distanceFromStart };
			rulerMarkerRef.current.push(marker);
			rulerPointDataRef.current.push(pointData);

			const points = rulerMarkerRef.current.map((m) => m.getLatLng());

			if (rulerLayerRef.current) {
				rulerLayerRef.current.setLatLngs(points);
			} else {
				rulerLayerRef.current = L.polyline(points, RULER_POLYLINE_OPTIONS).addTo(map);
			}

			if (rulerPointDataRef.current.length >= 2) {
				const [dataA, dataB] = rulerPointDataRef.current;
				applyRulerSegmentAndTooltip(dataA, dataB, trailPoints, points as [L.LatLng, L.LatLng]);
				setRulerRange({
					distanceFromStartA: dataA.distanceFromStart,
					distanceFromStartB: dataB.distanceFromStart,
				});
			}
		};
	}); // end useLayoutEffect - keeps rulerClickHandlerRef.current in sync

	// Re-render the tooltip content when units / precision / locale change.
	useEffect(() => {
		if (!rulerTooltipRef.current || rulerPointDataRef.current.length < 2) {
			return;
		}
		const [dataA, dataB] = rulerPointDataRef.current;
		const trailPoints = useStore.getState().enhancedTrailPoints;
		const points = rulerMarkerRef.current.map((m) => m.getLatLng()) as [L.LatLng, L.LatLng];
		const opts = { units: units, distancePrecision: distancePrecision, t, tChart };
		const { content } = buildRulerSegmentAndTooltipContent(dataA, dataB, trailPoints, points, opts);
		rulerTooltipRef.current.setContent(content);
	}, [units, distancePrecision, t, tChart, buildRulerSegmentAndTooltipContent]);

	// When a user drags a range on the elevation chart, enable ruler and set the two points.
	useEffect(() => {
		const handleRulerSetFromChart = (e: Event): void => {
			const detail = (e as CustomEvent<RulerSetFromChartDetail>).detail;
			if (
				detail?.distanceFromStartA === null ||
				detail.distanceFromStartB === null ||
				!Number.isFinite(detail.distanceFromStartA) ||
				!Number.isFinite(detail.distanceFromStartB)
			)
				return;
			const distanceA = detail.distanceFromStartA;
			const distanceB = detail.distanceFromStartB;
			const trailPoints = useStore.getState().enhancedTrailPoints;
			if (!trailPoints || trailPoints.length === 0) return;

			const pointA = findPointAtDistance(trailPoints, distanceA);
			const pointB = findPointAtDistance(trailPoints, distanceB);
			if (!pointA || !pointB) return;

			if (!useMapStore.getState().isRulerEnabled) {
				setRulerEnabled(true);
			}

			clearRulerMarkersAndLayers();

			const latLngA = L.latLng(pointA.lat, pointA.lng);
			const latLngB = L.latLng(pointB.lat, pointB.lng);
			const marker1 = L.marker(latLngA, RULER_MARKER_OPTIONS).addTo(map);
			const marker2 = L.marker(latLngB, RULER_MARKER_OPTIONS).addTo(map);
			rulerMarkerRef.current = [marker1, marker2];
			rulerPointDataRef.current = [
				{ latlng: latLngA, distanceFromStart: pointA.distanceFromStart },
				{ latlng: latLngB, distanceFromStart: pointB.distanceFromStart },
			];

			const points = [latLngA, latLngB] as [L.LatLng, L.LatLng];
			rulerLayerRef.current = L.polyline(points, RULER_POLYLINE_OPTIONS).addTo(map);

			const [dataA, dataB] = rulerPointDataRef.current;
			const opts: RulerSegmentOpts = {
				units: useMapStore.getState().units,
				distancePrecision: useMapStore.getState().distancePrecision,
				t,
				tChart,
			};
			applyRulerSegmentAndTooltip(dataA, dataB, trailPoints, points, opts);
			setRulerRange({
				distanceFromStartA: pointA.distanceFromStart,
				distanceFromStartB: pointB.distanceFromStart,
			});
		};
		window.addEventListener(RULER_SET_FROM_CHART_EVENT, handleRulerSetFromChart);
		return () => window.removeEventListener(RULER_SET_FROM_CHART_EVENT, handleRulerSetFromChart);
	}, [map, setRulerEnabled, setRulerRange, t, tChart, clearRulerMarkersAndLayers, applyRulerSegmentAndTooltip]);

	// Unmount: detach the click handler and remove every ruler layer.
	useEffect(
		() => () => {
			map.off('click', stableRulerClick);
			if (rulerLayerRef.current) {
				map.removeLayer(rulerLayerRef.current);
			}
			rulerMarkerRef.current.forEach((marker) => map.removeLayer(marker));
			rulerMarkerRef.current = [];
			rulerPointDataRef.current = [];
			if (rulerTooltipRef.current) {
				map.removeLayer(rulerTooltipRef.current);
				rulerTooltipRef.current = null;
			}
			if (rulerSegmentHighlightRef.current) {
				map.removeLayer(rulerSegmentHighlightRef.current);
				rulerSegmentHighlightRef.current = null;
			}
		},
		[map, stableRulerClick],
	);

	return { isRulerEnabled, rulerRange, rulerAnnouncement, toggleRuler };
}
