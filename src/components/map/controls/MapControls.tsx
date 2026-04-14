'use client';

/**
 * Map overlay panel: direction/units, boundary toggles, share links, settings (precision, dark mode, etc.),
 * and optional test link. Uses useBlockMapPropagation so clicks don't drag the map.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useBlockMapPropagation } from '@/hooks';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import geoData from '@/../public/data/geoJsonHr.json';
import { calculateTrailMetadata } from '@/lib/map';
import {
	type EnhancedTrailPoint,
	type MapStoreState,
	type StoreState,
	type TrailDirection,
	type UnitSystem,
	useMapStore,
	useStore,
} from '@/lib/store';
import {
	buildShareProgressUrl,
	buildShareViewUrl,
	formatDistance,
	formatElevation,
	isWithinMapBoundary,
	type ShareBaseMapKey,
} from '@/lib/utils';
import { PROVIDER_TO_KEY } from '@/components/map/base-map-options';
import type { BaseMapProvider } from '@/lib/services/map-service';
import { config } from '@/lib/config';
import type * as GeoJSON from 'geojson';
import {
	IoArrowDownOutline,
	IoArrowUpOutline,
	IoCreateOutline,
	IoGridOutline,
	IoMapOutline,
	IoPrintOutline,
	IoRainyOutline,
	IoShareSocialOutline,
} from 'react-icons/io5';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Button } from '@/components/ui/Button';
import { useTranslations } from 'next-intl';
import { MapControlsButton } from './MapControlsButton';
import { MapControlsSharePanel } from './MapControlsSharePanel';
import { MapControlsPrecisionSlider } from './MapControlsPrecisionSlider';
import { MapControlsSettingsPanel } from './MapControlsSettingsPanel';
import { MapControlsColorAdjust } from './MapControlsColorAdjust';
import { MapControlsTestLink } from './MapControlsTestLink';
import { MapControlsExportPanel } from './MapControlsExportPanel';
import { fitMapToRulerBounds } from '@/lib/export-utils';
import { RULER_SET_FROM_CHART_EVENT, type RulerSetFromChartDetail } from '@/lib/ruler-from-chart';

function getCroatiaGeoJsonBoundary(): GeoJSON.FeatureCollection {
	return {
		type: 'FeatureCollection',
		features: [{ type: 'Feature', properties: {}, geometry: geoData.geojson }],
	} as GeoJSON.FeatureCollection;
}

function createCroatiaBoundaryLayer(map: L.Map, borderLabel: string): L.GeoJSON {
	const geoJsonBoundary = getCroatiaGeoJsonBoundary();
	return L.geoJSON(geoJsonBoundary, {
		style: () => ({
			color: 'var(--cldt-blue)',
			weight: 3,
			opacity: 0.9,
			fillColor: 'transparent',
			fillOpacity: 0,
			fill: false,
		}),
		onEachFeature: function (_feature, layer) {
			let tooltip: L.Tooltip;
			layer.on('mouseover', function (e: L.LeafletMouseEvent) {
				const latlng = e.latlng || map.getCenter();
				tooltip = L.tooltip({
					permanent: false,
					direction: 'top',
					className: 'border-tooltip',
					offset: [0, -5],
				})
					.setLatLng(latlng)
					.setContent(borderLabel)
					.addTo(map);
			});
			layer.on('mouseout', function () {
				if (tooltip) map.removeLayer(tooltip);
			});
			layer.on('mousemove', function (e: L.LeafletMouseEvent) {
				if (tooltip) tooltip.setLatLng(e.latlng);
			});
		},
	});
}

function findPointAtDistance(enhancedTrailPoints: EnhancedTrailPoint[], distanceM: number): EnhancedTrailPoint | null {
	let closest = enhancedTrailPoints[0];
	let minDiff = Math.abs(closest.distanceFromStart - distanceM);
	for (let i = 1; i < enhancedTrailPoints.length; i++) {
		const d = Math.abs(enhancedTrailPoints[i].distanceFromStart - distanceM);
		if (d < minDiff) {
			minDiff = d;
			closest = enhancedTrailPoints[i];
		}
	}
	return closest;
}

const RULER_MARKER_ICON = L.divIcon({
	className: 'ruler-point',
	html: '<div class="w-3 h-3 bg-(--cldt-blue) rounded-full"></div>',
	iconSize: [12, 12],
	iconAnchor: [6, 6],
});

/**
 * Pane name for ruler polylines; z-index above overlay so ruler always draws on top of the trail.
 * We use this instead of leaflet's bringToFront() because it only reorders inside one pane and
 * can’t reliably beat the trail when the trail is re-added later; a higher-z-index pane makes
 * the ruler always on top regardless of add order.
 * */

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

function createAndAddTileBoundaryCanvas(map: L.Map, urlTemplate: string): L.TileLayer {
	const boundary = getCroatiaGeoJsonBoundary();
	const BoundaryCanvasCtor = (
		L.TileLayer as unknown as {
			BoundaryCanvas: new (url: string, opts: unknown) => L.TileLayer;
		}
	).BoundaryCanvas;
	const layer = new BoundaryCanvasCtor(urlTemplate, {
		boundary,
		attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
		maxZoom: 19,
		subdomains: 'abc',
	});
	map.eachLayer((l) => {
		if (l instanceof L.TileLayer && !(l instanceof BoundaryCanvasCtor)) {
			map.removeLayer(l);
		}
	});
	layer.addTo(map);
	return layer;
}

interface MapControlsProps {
	onToggleDirection?: (direction: TrailDirection) => void;
	onToggleUnits?: (units: UnitSystem) => void;
	initialDirection?: TrailDirection;
	initialUnits?: UnitSystem;
}

interface ExtendedMap extends L.Map {
	_enforcingBounds?: boolean;
}

const MapControls: React.FC<MapControlsProps> = ({
	onToggleDirection = () => {},
	onToggleUnits = () => {},
	initialDirection = 'SOBO',
	initialUnits = 'metric',
}): React.ReactElement => {
	const map = useMap() as ExtendedMap;
	const t = useTranslations('mapControls');
	const tChart = useTranslations('elevationChart');
	const tExport = useTranslations('mapExport');
	const [direction, setDirectionState] = useState<TrailDirection>(initialDirection);
	const [units, setUnitsState] = useState<UnitSystem>(initialUnits);
	const [isShowingBoundary, setIsShowingBoundary] = useState(false);
	const [isSharing, setIsSharing] = useState(false);
	const [isExporting, setIsExporting] = useState(false);
	const [showTilesBoundary, setShowTilesBoundary] = useState(false);
	const [tileBoundaryReinitKey, setTileBoundaryReinitKey] = useState(0);
	const [isColorAdjustEnabled, setIsColorAdjustEnabled] = useState(false);
	const [distancePrecisionState, setDistancePrecisionState] = useState(config.distancePrecision);
	const [isPrecisionExpanded, setIsPrecisionExpanded] = useState(false);
	const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);
	const precisionContainerRef = useRef<HTMLDivElement>(null);
	const settingsContainerRef = useRef<HTMLDivElement>(null);
	const colorAdjustContainerRef = useRef<HTMLDivElement>(null);
	const testLinkRef = useRef<HTMLDivElement>(null);
	const topRightControlsRef = useRef<HTMLDivElement>(null);
	const sharePopupRef = useRef<HTMLDivElement>(null);
	const exportPanelRef = useRef<HTMLDivElement>(null);

	useBlockMapPropagation(testLinkRef);
	useBlockMapPropagation(topRightControlsRef);
	useBlockMapPropagation(precisionContainerRef);
	useBlockMapPropagation(settingsContainerRef);
	useBlockMapPropagation(colorAdjustContainerRef);
	useBlockMapPropagation(exportPanelRef);

	const setDarkMode = useMapStore((state: MapStoreState) => state.setDarkMode);
	const setBatterySaverMode = useMapStore((state: MapStoreState) => state.setBatterySaverMode);
	const setLargeTouchTargets = useMapStore((state: MapStoreState) => state.setLargeTouchTargets);
	const setShowSections = useMapStore((state: MapStoreState) => state.setShowSections);
	const darkMode = useMapStore((state: MapStoreState) => state.darkMode);
	const batterySaverMode = useMapStore((state: MapStoreState) => state.batterySaverMode);
	const largeTouchTargets = useMapStore((state: MapStoreState) => state.largeTouchTargets);
	const showSections = useMapStore((state: MapStoreState) => state.showSections);
	const userLocation = useMapStore((state: MapStoreState) => state.userLocation);
	const permissionStatus = useMapStore((state: MapStoreState) => state.permissionStatus);
	const highlightedTrailPoint = useStore((state: StoreState) => state.highlightedTrailPoint);

	const withinMapBoundary = userLocation ? isWithinMapBoundary(userLocation.lat, userLocation.lng) : false;
	const hasUserLocationInBounds = !!userLocation && permissionStatus === 'granted' && withinMapBoundary;
	const canShare = hasUserLocationInBounds || !!highlightedTrailPoint;

	// Block map propagation on the share popup when it mounts
	useEffect(() => {
		if (isSharing && sharePopupRef.current) {
			L.DomEvent.disableClickPropagation(sharePopupRef.current);
			L.DomEvent.disableScrollPropagation(sharePopupRef.current);
		}
	}, [isSharing]);

	const boundaryLayerRef = useRef<L.GeoJSON | null>(null);
	const boundaryCanvasLayerRef = useRef<L.TileLayer | null>(null);
	const rulerLayerRef = useRef<L.Polyline | null>(null);
	const rulerMarkerRef = useRef<L.Marker[]>([]);
	const rulerTooltipRef = useRef<L.Tooltip | null>(null);
	const rulerPointDataRef = useRef<{ latlng: L.LatLng; distanceFromStart: number }[]>([]);
	const rulerSegmentHighlightRef = useRef<L.Polyline | null>(null);
	const rulerClickHandlerRef = useRef<(e: L.LeafletMouseEvent) => void>(() => {});
	const lastDirectionRef = useRef<TrailDirection | undefined>(undefined);
	const colorAdjustRef = useRef<HTMLElement | null>(null);

	const stableRulerClick = useCallback((e: L.LeafletMouseEvent) => {
		rulerClickHandlerRef.current(e);
	}, []);

	const setDirection = useMapStore((state: MapStoreState) => state.setDirection);
	const setUnits = useMapStore((state: MapStoreState) => state.setUnits);
	const setShowBoundary = useMapStore((state: MapStoreState) => state.setShowBoundary);
	const setShowTileBoundary = useMapStore((state: MapStoreState) => state.setShowTileBoundary);
	const showRadarOverlay = useMapStore((state: MapStoreState) => state.showRadarOverlay);
	const setShowRadarOverlay = useMapStore((state: MapStoreState) => state.setShowRadarOverlay);
	const isRulerEnabled = useMapStore((state: MapStoreState) => state.isRulerEnabled);
	const setRulerEnabled = useMapStore((state: MapStoreState) => state.setRulerEnabled);
	const rulerRange = useMapStore((state: MapStoreState) => state.rulerRange);
	const setRulerRange = useMapStore((state: MapStoreState) => state.setRulerRange);
	const setDistancePrecision = useMapStore((state: MapStoreState) => state.setDistancePrecision);
	const walkingPaceKmh = useMapStore((state: MapStoreState) => state.walkingPaceKmh);
	const setWalkingPaceKmh = useMapStore((state: MapStoreState) => state.setWalkingPaceKmh);

	const storeDirection = useMapStore((state: MapStoreState) => state.direction);
	const enhancedTrailPoints = useStore((state: StoreState) => state.enhancedTrailPoints);
	const storeDistancePrecision = useMapStore((state: MapStoreState) => state.distancePrecision);
	const storeUnits = useMapStore((state: MapStoreState) => state.units);
	const storeShowBoundary = useMapStore((state: MapStoreState) => state.showBoundary);
	const storeShowTileBoundary = useMapStore((state: MapStoreState) => state.showTileBoundary);
	const baseMapProvider = useMapStore((state: MapStoreState) => state.baseMapProvider);
	const gpxLoadFailed = useMapStore((state: MapStoreState) => state.gpxLoadFailed);
	const prevBaseMapProviderRef = useRef(baseMapProvider);

	const [colorSettings, setColorSettings] = useState({
		brightness: 100,
		contrast: 100,
		saturation: 100,
	});

	const closeOverlayTools = useCallback((): void => {
		setIsPrecisionExpanded(false);
		setIsColorAdjustEnabled(false);
		setIsSettingsExpanded(false);
		setIsExporting(false);
	}, []);

	// Close precision slider when clicking outside
	useEffect(() => {
		if (!isPrecisionExpanded) {
			return;
		}
		const handleClickOutside = (e: MouseEvent): void => {
			if (precisionContainerRef.current && !precisionContainerRef.current.contains(e.target as Node)) {
				setIsPrecisionExpanded(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isPrecisionExpanded]);

	useEffect(() => {
		if (!isColorAdjustEnabled) {
			return;
		}
		const handleClickOutside = (e: MouseEvent): void => {
			if (colorAdjustContainerRef.current && !colorAdjustContainerRef.current.contains(e.target as Node)) {
				setIsColorAdjustEnabled(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isColorAdjustEnabled]);

	useEffect(() => {
		if (!isSharing) {
			return;
		}
		const handleClickOutside = (e: MouseEvent): void => {
			if (sharePopupRef.current && !sharePopupRef.current.contains(e.target as Node)) {
				setIsSharing(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isSharing]);

	useEffect(() => {
		if (!isExporting) {
			return;
		}
		const handleClickOutside = (e: MouseEvent): void => {
			if (exportPanelRef.current && !exportPanelRef.current.contains(e.target as Node)) {
				setIsExporting(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isExporting]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key !== 'Escape') return;
			closeOverlayTools();
			if (isSharing) setIsSharing(false);
			else if (isRulerEnabled) setRulerEnabled(false);
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [isSharing, isRulerEnabled, closeOverlayTools, setRulerEnabled]);

	useEffect(() => {
		const handleCloseOverlays = (): void => {
			setIsPrecisionExpanded(false);
			setIsColorAdjustEnabled(false);
			setIsSharing(false);
		};
		window.addEventListener('closeMapControlOverlays', handleCloseOverlays);
		return () => window.removeEventListener('closeMapControlOverlays', handleCloseOverlays);
	}, []);

	useEffect(() => {
		const mapElement = document.querySelector('.leaflet-container') as HTMLElement;
		if (!mapElement) {
			return;
		}
		if (isColorAdjustEnabled) {
			mapElement.style.filter = `
                brightness(${colorSettings.brightness}%)
                contrast(${colorSettings.contrast}%)
                saturate(${colorSettings.saturation}%)
            `;
		} else {
			mapElement.style.filter = '';
		}
	}, [isColorAdjustEnabled, colorSettings]);

	useEffect(() => {
		const mapContainer = map?.getContainer();
		if (!mapContainer) {
			return;
		}
		if (isColorAdjustEnabled) {
			const overlay = document.createElement('div');
			overlay.className = 'color-adjust-overlay';
			overlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: var(--z-map-overlay);
                pointer-events: none;
                mix-blend-mode: multiply;
                background-color: rgba(255, 255, 230, 0.2);
            `;
			mapContainer.appendChild(overlay);
			colorAdjustRef.current = overlay;
		} else {
			if (colorAdjustRef.current) {
				colorAdjustRef.current.remove();
				colorAdjustRef.current = null;
			}
		}
		return () => {
			if (colorAdjustRef.current) {
				colorAdjustRef.current.remove();
				colorAdjustRef.current = null;
			}
		};
	}, [map, isColorAdjustEnabled]);

	const toggleDirection = (): void => {
		closeOverlayTools();
		const newDirection = direction === 'SOBO' ? 'NOBO' : 'SOBO';
		setDirectionState(newDirection);

		setDirection(newDirection);
		useStore.getState().broadcastDirectionChange(newDirection);
		onToggleDirection(newDirection);
	};

	const toggleUnits = (): void => {
		closeOverlayTools();
		const newUnits = units === 'metric' ? 'imperial' : 'metric';
		setUnitsState(newUnits);

		setUnits(newUnits);
		useStore.getState().broadcastUnitsChange(newUnits);
		onToggleUnits(newUnits);
	};

	const toggleBoundary = (): void => {
		closeOverlayTools();
		const shouldShow = !isShowingBoundary;
		setIsShowingBoundary(shouldShow);
		setShowBoundary(shouldShow);

		if (shouldShow) {
			if (!boundaryLayerRef.current) {
				try {
					const boundary = createCroatiaBoundaryLayer(map, t('borderOfCroatia'));
					boundaryLayerRef.current = boundary;
					boundary.addTo(map);
					map.fitBounds(boundary.getBounds(), { padding: [50, 50] });
				} catch (error) {
					console.error('Error creating boundary:', error);
				}
			} else {
				boundaryLayerRef.current.addTo(map);
			}
		} else {
			if (boundaryLayerRef.current) {
				map.removeLayer(boundaryLayerRef.current);
			}

			const tileContainer = map.getContainer().querySelector('.leaflet-tile-container') as HTMLElement;
			if (tileContainer) {
				tileContainer.style.clipPath = 'none';
			}
		}
	};

	const toggleTilesBoundary = async (): Promise<void> => {
		closeOverlayTools();
		const shouldShow = !showTilesBoundary;

		setShowTilesBoundary(shouldShow);

		try {
			if (shouldShow) {
				await import('leaflet-boundary-canvas');

				let baseLayerUrl = document.querySelector('.leaflet-tile-pane img')?.getAttribute('src');

				if (!baseLayerUrl) {
					baseLayerUrl = 'https://a.tile.openstreetmap.org/0/0/0.png';
				}

				const urlTemplate = baseLayerUrl
					.replace(/\/\d+\/\d+\/\d+\.png.*$/, '/{z}/{x}/{y}.png')
					.replace(/^https?:\/\/[a-z]\./, 'https://{s}.');

				if (boundaryCanvasLayerRef.current) {
					boundaryCanvasLayerRef.current.addTo(map);
				} else if ((L.TileLayer as unknown as { BoundaryCanvas?: unknown }).BoundaryCanvas) {
					boundaryCanvasLayerRef.current = createAndAddTileBoundaryCanvas(map, urlTemplate);
				}
			} else {
				if (boundaryCanvasLayerRef.current) {
					map.removeLayer(boundaryCanvasLayerRef.current);
					boundaryCanvasLayerRef.current = null;
					// Signal BaseMapSelector to restore the currently selected base layer.
					// (createAndAddTileBoundaryCanvas removed the original tile layer when it was added.)
					window.dispatchEvent(new CustomEvent('restoreBaseMapLayer'));
				}
			}

			setShowTileBoundary(shouldShow);
		} catch (error) {
			console.error('Error toggling tile boundary:', error);

			setShowTilesBoundary(!shouldShow);

			alert(t('tileBoundaryError', { action: shouldShow ? t('tileBoundaryEnabling') : t('tileBoundaryDisabling') }));
		}
	};

	const getShareViewUrl = (): string => {
		const center = map.getCenter();
		const zoom = map.getZoom();
		const baseMapKey = baseMapProvider
			? (PROVIDER_TO_KEY[baseMapProvider as BaseMapProvider] as ShareBaseMapKey | undefined)
			: undefined;
		const shareRulerRange = isRulerEnabled ? rulerRange : null;
		return buildShareViewUrl(window.location.origin + window.location.pathname, {
			lat: center.lat,
			lng: center.lng,
			zoom,
			direction: storeDirection,
			baseMap: baseMapKey,
			sections: showSections,
			dark: darkMode,
			rulerRange: shareRulerRange,
		});
	};

	const getShareProgressUrl = (): string | null => {
		const state = useStore.getState();
		const closestPoint = state.closestPoint;
		const totalKm = state.trailMetadata?.totalDistance ?? 0;
		if (totalKm <= 0) return null;

		const unit = units === 'imperial' ? 'mi' : 'km';
		const zoom = map.getZoom();

		const baseMapKey = baseMapProvider
			? (PROVIDER_TO_KEY[baseMapProvider as BaseMapProvider] as ShareBaseMapKey | undefined)
			: undefined;
		const shareRulerRange = isRulerEnabled ? rulerRange : null;
		const styleParams = {
			baseMap: baseMapKey,
			sections: showSections,
			dark: darkMode,
			rulerRange: shareRulerRange,
		};

		if (highlightedTrailPoint) {
			const kmFromStart = highlightedTrailPoint.distanceFromStart / 1000;
			return buildShareProgressUrl(window.location.origin + window.location.pathname, {
				kmFromStart,
				direction: storeDirection,
				unit,
				zoom,
				...styleParams,
			});
		}

		if (closestPoint) {
			const kmFromStart = closestPoint.distanceFromStart / 1000;
			return buildShareProgressUrl(window.location.origin + window.location.pathname, {
				kmFromStart,
				direction: storeDirection,
				unit,
				zoom,
				...styleParams,
			});
		}

		return null;
	};

	const handleShare = (): void => {
		closeOverlayTools();
		setIsSharing((prev) => !prev);
	};

	const [showCopyToast, setShowCopyToast] = useState(false);
	const copyToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const copyToClipboard = (url: string, withText = false): void => {
		const text = withText ? `${t('shareText')}\n${url}` : url;
		navigator.clipboard
			.writeText(text)
			.then(() => {
				setShowCopyToast(true);
				if (copyToastTimeoutRef.current) clearTimeout(copyToastTimeoutRef.current);
				copyToastTimeoutRef.current = setTimeout(() => {
					setShowCopyToast(false);
					setIsSharing(false);
					copyToastTimeoutRef.current = null;
				}, 1500);
			})
			.catch((err) => {
				console.error('Could not copy text:', err);
			});
	};

	useEffect(
		() => () => {
			if (copyToastTimeoutRef.current) clearTimeout(copyToastTimeoutRef.current);
			if (rulerAnnouncementTimeoutRef.current) clearTimeout(rulerAnnouncementTimeoutRef.current);
		},
		[],
	);

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

	type RulerPointData = { latlng: L.LatLng; distanceFromStart: number };
	const buildRulerSegmentAndTooltipContent = useCallback(
		(
			dataA: RulerPointData,
			dataB: RulerPointData,
			enhancedTrailPoints: EnhancedTrailPoint[] | null,
			points: [L.LatLng, L.LatLng],
			opts: { units: UnitSystem; distancePrecision: number; t: (k: string) => string; tChart: (k: string) => string },
		) => {
			const hasTrail = enhancedTrailPoints && enhancedTrailPoints.length > 0;
			const distA = dataA.distanceFromStart;
			const distB = dataB.distanceFromStart;
			const distanceBetween = hasTrail ? Math.abs(distB - distA) : calculateTrailMetadata(points).totalDistance;
			const minDist = Math.min(distA, distB);
			const maxDist = Math.max(distA, distB);
			const segment =
				hasTrail && enhancedTrailPoints
					? enhancedTrailPoints
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

	type RulerSegmentOpts = {
		units: UnitSystem;
		distancePrecision: number;
		t: (k: string) => string;
		tChart: (k: string) => string;
	};
	const applyRulerSegmentAndTooltip = useCallback(
		(
			dataA: RulerPointData,
			dataB: RulerPointData,
			enhancedTrailPoints: EnhancedTrailPoint[] | null,
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
				units,
				distancePrecision: distancePrecisionState,
				t,
				tChart,
			};
			const { content, midPoint, segmentPoints } = buildRulerSegmentAndTooltipContent(
				dataA,
				dataB,
				enhancedTrailPoints,
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
		[units, distancePrecisionState, t, tChart, buildRulerSegmentAndTooltipContent, map],
	);

	const [rulerAnnouncement, setRulerAnnouncement] = useState<string | null>(null);
	const rulerAnnouncementTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const toggleRuler = (): void => {
		closeOverlayTools();
		const willBeEnabled = !isRulerEnabled;
		setRulerEnabled(willBeEnabled);
		const msg = willBeEnabled ? t('rulerEnable') : t('rulerDisable');
		if (rulerAnnouncementTimeoutRef.current) clearTimeout(rulerAnnouncementTimeoutRef.current);
		setRulerAnnouncement(msg);
		rulerAnnouncementTimeoutRef.current = setTimeout(() => {
			setRulerAnnouncement(null);
			rulerAnnouncementTimeoutRef.current = null;
		}, 1000);
	};

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
			lastDirectionRef.current = storeDirection;
			return;
		}
		if (lastDirectionRef.current !== undefined && lastDirectionRef.current !== storeDirection) {
			const totalM = enhancedTrailPoints[enhancedTrailPoints.length - 1]?.distanceFromStart ?? 0;
			setRulerRange({
				distanceFromStartA: totalM - rulerRange.distanceFromStartB,
				distanceFromStartB: totalM - rulerRange.distanceFromStartA,
			});
		}
		lastDirectionRef.current = storeDirection;
	}, [storeDirection, isRulerEnabled, rulerRange, enhancedTrailPoints, setRulerRange]);

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
			units: storeUnits,
			distancePrecision: storeDistancePrecision,
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
		storeUnits,
		storeDistancePrecision,
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

	rulerClickHandlerRef.current = (e: L.LeafletMouseEvent): void => {
		const { latlng } = e;

		const enhancedTrailPoints = useStore.getState().enhancedTrailPoints;
		let resolvedLatLng = latlng;
		let distanceFromStart = 0;

		if (enhancedTrailPoints && enhancedTrailPoints.length > 0) {
			let closest = enhancedTrailPoints[0];
			let minDist = L.latLng(closest.lat, closest.lng).distanceTo(latlng);
			for (let i = 1; i < enhancedTrailPoints.length; i++) {
				const p = enhancedTrailPoints[i];
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
			applyRulerSegmentAndTooltip(dataA, dataB, enhancedTrailPoints, points as [L.LatLng, L.LatLng]);
			setRulerRange({
				distanceFromStartA: dataA.distanceFromStart,
				distanceFromStartB: dataB.distanceFromStart,
			});
		}
	};

	useEffect(() => {
		if (!rulerTooltipRef.current || rulerPointDataRef.current.length < 2) {
			return;
		}
		const [dataA, dataB] = rulerPointDataRef.current;
		const enhancedTrailPoints = useStore.getState().enhancedTrailPoints;
		const points = rulerMarkerRef.current.map((m) => m.getLatLng()) as [L.LatLng, L.LatLng];
		const opts = { units, distancePrecision: distancePrecisionState, t, tChart };
		const { content } = buildRulerSegmentAndTooltipContent(dataA, dataB, enhancedTrailPoints, points, opts);
		rulerTooltipRef.current.setContent(content);
	}, [units, distancePrecisionState, t, tChart, buildRulerSegmentAndTooltipContent]);

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
			const enhancedTrailPoints = useStore.getState().enhancedTrailPoints;
			if (!enhancedTrailPoints || enhancedTrailPoints.length === 0) return;

			const pointA = findPointAtDistance(enhancedTrailPoints, distanceA);
			const pointB = findPointAtDistance(enhancedTrailPoints, distanceB);
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
			applyRulerSegmentAndTooltip(dataA, dataB, enhancedTrailPoints, points, opts);
			setRulerRange({
				distanceFromStartA: pointA.distanceFromStart,
				distanceFromStartB: pointB.distanceFromStart,
			});
		};
		window.addEventListener(RULER_SET_FROM_CHART_EVENT, handleRulerSetFromChart);
		return () => window.removeEventListener(RULER_SET_FROM_CHART_EVENT, handleRulerSetFromChart);
	}, [
		map,
		setRulerEnabled,
		setRulerRange,
		stableRulerClick,
		t,
		tChart,
		clearRulerMarkersAndLayers,
		applyRulerSegmentAndTooltip,
	]);

	const toggleColorAdjust = (): void => {
		setIsColorAdjustEnabled((prev) => !prev);
	};

	const handlePrint = (): void => {
		setIsExporting(false);
		// beforeprint fires after @media print CSS is applied (container resized to paper dimensions)
		// but before the print dialog - invalidate size and re-fit bounds
		const onBeforePrint = (): void => {
			map.invalidateSize({ animate: false });
			if (rulerRange) {
				const pts = useStore.getState().enhancedTrailPoints;
				if (pts?.length) {
					fitMapToRulerBounds(map, rulerRange, pts, { animate: false, padding: [30, 30] });
				}
			}
		};
		window.addEventListener('beforeprint', onBeforePrint, { once: true });
		window.print();
	};

	const handlePngDownload = (): void => {
		setIsExporting(false);
		if (rulerRange && enhancedTrailPoints?.length) {
			fitMapToRulerBounds(map, rulerRange, enhancedTrailPoints);
		}
		setTimeout(async () => {
			try {
				const { toBlob } = await import('html-to-image');
				const mapEl = document.querySelector<HTMLElement>('.leaflet-container');
				if (!mapEl) return;
				const blob = await toBlob(mapEl, { cacheBust: true });
				if (!blob) return;
				const url = URL.createObjectURL(blob);
				const link = document.createElement('a');
				link.download = 'cldt-map.png';
				link.href = url;
				link.click();
				URL.revokeObjectURL(url);
			} catch (err) {
				console.error('PNG export failed:', err instanceof Error ? err.message : String(err));
			}
		}, 600);
	};

	useEffect(() => {
		const initFromStore = (): void => {
			if (typeof storeDirection !== 'undefined') {
				setDirectionState(storeDirection);
				useStore.getState().broadcastDirectionChange(storeDirection);
			}

			if (typeof storeUnits !== 'undefined') {
				setUnitsState(storeUnits);
				useStore.getState().setUnits(storeUnits);
			}

			if (typeof storeDistancePrecision !== 'undefined') {
				setDistancePrecisionState(storeDistancePrecision);
			}

			if (typeof storeShowBoundary !== 'undefined') {
				setIsShowingBoundary(storeShowBoundary);

				if (storeShowBoundary && !boundaryLayerRef.current && map) {
					try {
						setTimeout(() => {
							const boundary = createCroatiaBoundaryLayer(map, t('borderOfCroatia'));
							boundaryLayerRef.current = boundary;
							boundary.addTo(map);
						}, 300);
					} catch (error) {
						console.error('Error initializing boundary:', error);
					}
				}
			}

			if (typeof storeShowTileBoundary !== 'undefined') {
				setShowTilesBoundary(storeShowTileBoundary);
			}
		};

		initFromStore();
	}, [storeDirection, storeUnits, storeShowBoundary, storeShowTileBoundary, storeDistancePrecision, map, t]);

	// When the base map provider changes while tile boundary is active, the old BoundaryCanvas
	// layer is removed by BaseMapSelector's handleMapChange (which removes all TileLayers).
	// The ref is stale (non-null but off the map), so the init effect below early-returns.
	// Clear the stale ref and increment the reinit key to force re-initialization with the new tile URL.
	useEffect(() => {
		if (prevBaseMapProviderRef.current === baseMapProvider) {
			prevBaseMapProviderRef.current = baseMapProvider;
			return;
		}
		prevBaseMapProviderRef.current = baseMapProvider;

		if (storeShowTileBoundary && boundaryCanvasLayerRef.current) {
			boundaryCanvasLayerRef.current = null;
			setTileBoundaryReinitKey((k) => k + 1);
		}
	}, [baseMapProvider, storeShowTileBoundary]);

	useEffect(() => {
		if (!storeShowTileBoundary || boundaryCanvasLayerRef.current) {
			return;
		}

		let cancelled = false;
		const timeoutIds: ReturnType<typeof setTimeout>[] = [];
		const clearAllTimeouts = (): void => {
			timeoutIds.forEach((id) => clearTimeout(id));
			timeoutIds.length = 0;
		};

		let retryCount = 0;
		const maxRetries = 5;

		const initTileBoundary = async (): Promise<void> => {
			if (cancelled) {
				return;
			}
			try {
				await import('leaflet-boundary-canvas');
				if (cancelled) {
					return;
				}

				let baseLayerUrl = document.querySelector('.leaflet-tile-pane img')?.getAttribute('src');

				if (!baseLayerUrl && retryCount < maxRetries) {
					retryCount++;
					const delay = 1000 * Math.pow(1.5, retryCount);
					const id = setTimeout(initTileBoundary, delay);
					timeoutIds.push(id);
					return;
				}

				if (!baseLayerUrl) {
					baseLayerUrl = 'https://a.tile.openstreetmap.org/0/0/0.png';
				}

				const urlTemplate = baseLayerUrl
					.replace(/\/\d+\/\d+\/\d+\.png.*$/, '/{z}/{x}/{y}.png')
					.replace(/^https?:\/\/[a-z]\./, 'https://{s}.');

				if ((L.TileLayer as unknown as { BoundaryCanvas?: unknown }).BoundaryCanvas && !cancelled) {
					boundaryCanvasLayerRef.current = createAndAddTileBoundaryCanvas(map, urlTemplate);
					if (!cancelled) {
						setShowTilesBoundary(true);
					}
				}
			} catch (error) {
				if (cancelled) {
					return;
				}
				console.error('Error initializing tile boundary layer:', error);

				if (retryCount < maxRetries) {
					retryCount++;
					const delay = 1000 * Math.pow(1.5, retryCount);
					const id = setTimeout(initTileBoundary, delay);
					timeoutIds.push(id);
				} else {
					console.error('Max retries reached, disabling tile boundary');
					if (!cancelled) {
						setShowTilesBoundary(false);
						setShowTileBoundary(false);
					}
				}
			}
		};

		const initialId = setTimeout(initTileBoundary, 1000);
		timeoutIds.push(initialId);

		return () => {
			cancelled = true;
			clearAllTimeouts();
		};
	}, [map, setShowTileBoundary, storeShowTileBoundary, tileBoundaryReinitKey]);

	const setDistancePrecisionHandler = (precision: number): void => {
		setDistancePrecisionState(precision);
		setDistancePrecision(precision);
	};

	useEffect(() => {
		try {
			const container = map.getContainer();

			const stopDoubleClick = (e: MouseEvent): void => {
				const target = e.target as HTMLElement;
				const isControl = target.closest('.leaflet-control') !== null;

				if (isControl) {
					return;
				}

				if (e.detail > 1) {
					e.stopPropagation();
				}
			};

			container.addEventListener('click', stopDoubleClick);

			return () => {
				container.removeEventListener('click', stopDoubleClick);
			};
		} catch (error) {
			console.error('Error setting up double-click prevention:', error);
		}
	}, [map]);

	useEffect(
		() => () => {
			map.off('click', stableRulerClick);

			if (boundaryLayerRef.current) {
				map.removeLayer(boundaryLayerRef.current);
			}

			if (boundaryCanvasLayerRef.current) {
				map.removeLayer(boundaryCanvasLayerRef.current);
			}

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

			if (colorAdjustRef.current) {
				colorAdjustRef.current.remove();
				colorAdjustRef.current = null;
			}

			const mapElement = document.querySelector('.leaflet-container') as HTMLElement;
			if (mapElement) {
				mapElement.style.filter = '';
			}
		},
		[map, stableRulerClick],
	);

	const controlsDisabledClass = gpxLoadFailed ? 'pointer-events-none opacity-60' : '';

	return (
		<>
			{process.env.NODE_ENV === 'development' && (
				<div className={controlsDisabledClass}>
					<MapControlsTestLink containerRef={testLinkRef} label={t('testStore')} />
				</div>
			)}

			<div
				className={`map-controls-top-row z-controls absolute top-[58px] right-2 flex flex-col gap-2 ${controlsDisabledClass}`}
				ref={topRightControlsRef}
				onContextMenu={(e) => e.preventDefault()}
			>
				<SmartTooltip
					content={t('directionTooltip', {
						direction: direction === 'SOBO' ? t('directionSouthbound') : t('directionNorthbound'),
					})}
					position="left"
				>
					<Button
						aria-label={t('directionTooltip', {
							direction: direction === 'SOBO' ? t('directionSouthbound') : t('directionNorthbound'),
						})}
						title={`Change Direction (Currently ${direction === 'SOBO' ? t('directionTitleNorthSouth') : t('directionTitleSouthNorth')})`}
						variant="controlRound"
						onClick={toggleDirection}
					>
						{direction === 'SOBO' ? (
							<IoArrowDownOutline aria-hidden className="h-5 w-5" />
						) : (
							<IoArrowUpOutline aria-hidden className="h-5 w-5" />
						)}
					</Button>
				</SmartTooltip>

				<SmartTooltip
					content={t('unitsTooltip', {
						units: units === 'metric' ? t('unitsMetric') : t('unitsImperial'),
					})}
					position="left"
				>
					<Button
						aria-label={t('unitsTooltip', { units: units === 'metric' ? t('unitsMetric') : t('unitsImperial') })}
						className="text-cldt-blue-contrast font-semibold"
						variant="controlRound"
						onClick={toggleUnits}
					>
						<span aria-hidden="true">{units === 'metric' ? 'km' : 'mi'}</span>
					</Button>
				</SmartTooltip>

				<MapControlsPrecisionSlider
					containerRef={precisionContainerRef}
					isExpanded={isPrecisionExpanded}
					tooltipContent={t('precisionClick', { value: distancePrecisionState })}
					tooltipExpanded={t('precisionDrag')}
					value={distancePrecisionState}
					onChange={setDistancePrecisionHandler}
					onToggle={() => {
						setIsPrecisionExpanded((prev) => {
							if (!prev) {
								setIsColorAdjustEnabled(false);
								setIsSharing(false);
							}
							return !prev;
						});
					}}
				/>

				<MapControlsButton
					active={isShowingBoundary}
					ariaLabel={isShowingBoundary ? t('boundaryHide') : t('boundaryShow')}
					content={isShowingBoundary ? t('boundaryHide') : t('boundaryShow')}
					onClick={toggleBoundary}
				>
					<IoMapOutline aria-hidden className="h-5 w-5" />
				</MapControlsButton>

				<MapControlsButton
					active={isRulerEnabled}
					ariaLabel={isRulerEnabled ? t('rulerDisable') : t('rulerEnable')}
					content={isRulerEnabled ? t('rulerDisable') : t('rulerEnable')}
					onClick={toggleRuler}
				>
					<IoCreateOutline aria-hidden className="h-5 w-5" />
				</MapControlsButton>

				<MapControlsButton
					active={showTilesBoundary}
					ariaLabel={showTilesBoundary ? t('tilesDisable') : t('tilesEnable')}
					content={showTilesBoundary ? t('tilesDisable') : t('tilesEnable')}
					onClick={toggleTilesBoundary}
				>
					<IoGridOutline aria-hidden className="h-5 w-5" />
				</MapControlsButton>

				<MapControlsButton
					active={showRadarOverlay}
					ariaLabel={showRadarOverlay ? t('radarDisable') : t('radarEnable')}
					content={showRadarOverlay ? t('radarDisable') : t('radarEnable')}
					onClick={() => setShowRadarOverlay(!showRadarOverlay)}
				>
					<IoRainyOutline aria-hidden className="h-5 w-5" />
				</MapControlsButton>

				<MapControlsColorAdjust
					colorSettings={colorSettings}
					containerRef={colorAdjustContainerRef}
					isEnabled={isColorAdjustEnabled}
					setColorSettings={setColorSettings}
					tooltipHide={t('colorHide')}
					tooltipShow={t('colorShow')}
					onToggle={() => {
						if (!isColorAdjustEnabled) {
							setIsPrecisionExpanded(false);
							setIsSharing(false);
						}
						toggleColorAdjust();
					}}
				/>

				<MapControlsSettingsPanel
					batterySaverLabel={t('batterySaver')}
					batterySaverMode={batterySaverMode}
					batterySaverTooltip={t('batterySaverTooltip')}
					containerRef={settingsContainerRef}
					darkMode={darkMode}
					darkModeLabel={t('darkMode')}
					isExpanded={isSettingsExpanded}
					largeTouchTargets={largeTouchTargets}
					largeTouchTargetsLabel={t('largeTouchTargets')}
					preferencesTitle={t('preferences')}
					setBatterySaverMode={setBatterySaverMode}
					setDarkMode={setDarkMode}
					setLargeTouchTargets={setLargeTouchTargets}
					setShowSections={setShowSections}
					setWalkingPaceKmh={setWalkingPaceKmh}
					showSections={showSections}
					tooltipHide={t('preferencesHide')}
					tooltipShow={t('preferencesShow')}
					units={storeUnits}
					walkingPaceKmh={walkingPaceKmh}
					onToggle={() => {
						if (!isSettingsExpanded) {
							setIsPrecisionExpanded(false);
							setIsColorAdjustEnabled(false);
							setIsSharing(false);
						}
						setIsSettingsExpanded((prev) => !prev);
					}}
				/>

				<div className="relative inline-block w-10 shrink-0">
					<MapControlsButton
						ariaLabel={tExport('exportButtonLabel')}
						content={tExport('exportButtonLabel')}
						onClick={() => {
							closeOverlayTools();
							setIsExporting((prev) => !prev);
						}}
					>
						<IoPrintOutline aria-hidden className="h-5 w-5" />
					</MapControlsButton>
					{isExporting && (
						<MapControlsExportPanel
							baseMapProvider={baseMapProvider}
							containerRef={exportPanelRef}
							onClose={() => setIsExporting(false)}
							onPngDownload={handlePngDownload}
							onPrint={handlePrint}
						/>
					)}
				</div>

				<div className="relative inline-block w-10 shrink-0">
					<MapControlsButton
						ariaLabel={canShare ? t('shareMap') : t('shareUnavailable')}
						content={canShare ? t('shareMap') : t('shareUnavailable')}
						disabled={!canShare}
						onClick={canShare ? handleShare : undefined}
					>
						<IoShareSocialOutline aria-hidden className="h-5 w-5" />
					</MapControlsButton>
					{isSharing && (
						<MapControlsSharePanel
							copyToClipboard={copyToClipboard}
							getShareUrl={() => getShareProgressUrl() ?? getShareViewUrl()}
							sharePopupRef={sharePopupRef}
							onClose={() => setIsSharing(false)}
						/>
					)}
					{showCopyToast && (
						<div
							aria-live="polite"
							className="map-tooltip map-tooltip--pwa animate-slide-in-from-top fixed top-4 right-4 z-[var(--z-toast)]"
							role="status"
						>
							<p className="font-medium">{t('linkCopied')}</p>
						</div>
					)}
					{rulerAnnouncement && (
						<div aria-live="polite" className="sr-only" role="status">
							{rulerAnnouncement}
						</div>
					)}
				</div>
			</div>
		</>
	);
};

export default MapControls;
