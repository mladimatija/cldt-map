'use client';

/**
 * Map overlay panel: direction/units, boundary toggles, share links, settings (precision, dark mode, etc.),
 * and optional test link. Uses useBlockMapPropagation so clicks don't drag the map.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useBlockMapPropagation } from '@/hooks';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { siteMetadata } from '@/lib/metadata';
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
import { buildShareProgressUrl, buildShareViewUrl, formatDistance, isWithinMapBoundary } from '@/lib/utils';
import { config } from '@/lib/config';
import type * as GeoJSON from 'geojson';
import {
	IoArrowDownOutline,
	IoArrowUpOutline,
	IoCreateOutline,
	IoGridOutline,
	IoMapOutline,
	IoShareSocialOutline,
} from 'react-icons/io5';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { useTranslations } from 'next-intl';
import { MapControlButton } from './MapControlButton';
import { MapControlsSharePanel } from './MapControlsSharePanel';
import { MapControlsPrecisionSlider } from './MapControlsPrecisionSlider';
import { MapControlsSettingsPanel } from './MapControlsSettingsPanel';
import { MapControlsColorAdjust } from './MapControlsColorAdjust';
import { MapControlsTestLink } from './MapControlsTestLink';

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
	const [direction, setDirectionState] = useState<TrailDirection>(initialDirection);
	const [units, setUnitsState] = useState<UnitSystem>(initialUnits);
	const [isShowingBoundary, setIsShowingBoundary] = useState(false);
	const [isSharing, setIsSharing] = useState(false);
	const [showTilesBoundary, setShowTilesBoundary] = useState(false);
	const [isRulerEnabled, setIsRulerEnabled] = useState(false);
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

	useBlockMapPropagation(testLinkRef);
	useBlockMapPropagation(topRightControlsRef);
	useBlockMapPropagation(precisionContainerRef);
	useBlockMapPropagation(settingsContainerRef);
	useBlockMapPropagation(colorAdjustContainerRef);

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
	const colorAdjustRef = useRef<HTMLElement | null>(null);

	const setDirection = useMapStore((state: MapStoreState) => state.setDirection);
	const setUnits = useMapStore((state: MapStoreState) => state.setUnits);
	const setShowBoundary = useMapStore((state: MapStoreState) => state.setShowBoundary);
	const setShowTileBoundary = useMapStore((state: MapStoreState) => state.setShowTileBoundary);
	const setRulerEnabled = useMapStore((state: MapStoreState) => state.setRulerEnabled);
	const setDistancePrecision = useMapStore((state: MapStoreState) => state.setDistancePrecision);

	const storeDirection = useMapStore((state: MapStoreState) => state.direction);
	const storeDistancePrecision = useMapStore((state: MapStoreState) => state.distancePrecision);
	const storeUnits = useMapStore((state: MapStoreState) => state.units);
	const storeShowBoundary = useMapStore((state: MapStoreState) => state.showBoundary);
	const storeShowTileBoundary = useMapStore((state: MapStoreState) => state.showTileBoundary);

	const [colorSettings, setColorSettings] = useState({
		brightness: 100,
		contrast: 100,
		saturation: 100,
	});

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
		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key !== 'Escape') {
				return;
			}
			if (isPrecisionExpanded) {
				setIsPrecisionExpanded(false);
			} else if (isColorAdjustEnabled) {
				setIsColorAdjustEnabled(false);
			} else if (isSharing) {
				setIsSharing(false);
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [isPrecisionExpanded, isColorAdjustEnabled, isSharing]);

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

	const closeOverlayTools = (): void => {
		setIsPrecisionExpanded(false);
		setIsColorAdjustEnabled(false);
		setIsSettingsExpanded(false);
	};

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
					const geoJsonBoundary = {
						type: 'FeatureCollection',
						features: [
							{
								type: 'Feature',
								properties: {},
								geometry: geoData.geojson,
							},
						],
					} as GeoJSON.FeatureCollection;

					const boundary = L.geoJSON(geoJsonBoundary, {
						style: function () {
							return {
								color: '#00a6c7',
								weight: 3,
								opacity: 0.9,
								fillColor: 'transparent',
								fillOpacity: 0,
								fill: false,
							};
						},
						onEachFeature: function (_feature, layer) {
							let tooltip: L.Tooltip;

							layer.on('mouseover', function (e) {
								const latlng = e.latlng || map.getCenter();

								tooltip = L.tooltip({
									permanent: false,
									direction: 'top',
									className: 'border-tooltip',
									offset: [0, -5],
								})
									.setLatLng(latlng)
									.setContent(t('borderOfCroatia'))
									.addTo(map);
							});

							layer.on('mouseout', function () {
								if (tooltip) {
									map.removeLayer(tooltip);
								}
							});

							layer.on('mousemove', function (e) {
								if (tooltip) {
									tooltip.setLatLng(e.latlng);
								}
							});
						},
					});

					boundaryLayerRef.current = boundary;
					boundary.addTo(map);

					map.fitBounds(boundary.getBounds(), {
						padding: [50, 50],
					});
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
				const _boundaryCanvasModule = await import('leaflet-boundary-canvas');

				let baseLayerUrl = document.querySelector('.leaflet-tile-pane img')?.getAttribute('src');

				if (!baseLayerUrl) {
					baseLayerUrl = 'https://a.tile.openstreetmap.org/0/0/0.png';
				}

				const urlTemplate = baseLayerUrl
					.replace(/\/\d+\/\d+\/\d+\.png.*$/, '/{z}/{x}/{y}.png')
					.replace(/^https?:\/\/[a-z]\./, 'https://{s}.');

				const geoJsonBoundary = {
					type: 'FeatureCollection',
					features: [
						{
							type: 'Feature',
							properties: {},
							geometry: geoData.geojson,
						},
					],
				} as GeoJSON.FeatureCollection;

				if (boundaryCanvasLayerRef.current) {
					boundaryCanvasLayerRef.current.addTo(map);
				} else if (L.TileLayer.BoundaryCanvas) {
					const boundaryLayer = new L.TileLayer.BoundaryCanvas(urlTemplate, {
						boundary: geoJsonBoundary,
						attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
						maxZoom: 19,
						subdomains: 'abc',
					});

					map.eachLayer((layer) => {
						if (layer instanceof L.TileLayer && !(layer instanceof L.TileLayer.BoundaryCanvas)) {
							map.removeLayer(layer);
						}
					});

					boundaryCanvasLayerRef.current = boundaryLayer;
					boundaryLayer.addTo(map);
				}
			} else {
				if (boundaryCanvasLayerRef.current) {
					map.removeLayer(boundaryCanvasLayerRef.current);

					L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
						attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
					}).addTo(map);
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
		return buildShareViewUrl(window.location.origin + window.location.pathname, {
			lat: center.lat,
			lng: center.lng,
			zoom,
			direction: storeDirection,
		});
	};

	const getShareProgressUrl = (): string | null => {
		const state = useStore.getState();
		const closestPoint = state.closestPoint;
		const totalKm = state.trailMetadata?.totalDistance ?? 0;
		if (totalKm <= 0) return null;

		const unit = units === 'imperial' ? 'mi' : 'km';
		const zoom = map.getZoom();

		if (highlightedTrailPoint) {
			const kmFromStart = highlightedTrailPoint.distanceFromStart / 1000;
			return buildShareProgressUrl(window.location.origin + window.location.pathname, {
				kmFromStart,
				direction: storeDirection,
				unit,
				zoom,
			});
		}

		if (closestPoint) {
			const kmFromStart = closestPoint.distanceFromStart / 1000;
			return buildShareProgressUrl(window.location.origin + window.location.pathname, {
				kmFromStart,
				direction: storeDirection,
				unit,
				zoom,
			});
		}

		return null;
	};

	const handleShare = (): void => {
		closeOverlayTools();
		const shareUrl = getShareProgressUrl() ?? getShareViewUrl();
		if (navigator.share) {
			navigator
				.share({
					title: siteMetadata.title,
					text: t('shareText'),
					url: shareUrl,
				})
				.catch((error) => console.error('Error sharing:', error));
		} else {
			setIsSharing((prev) => !prev);
		}
	};

	const copyToClipboard = (url: string, withText = false): void => {
		const text = withText ? `${t('shareText')}\n${url}` : url;
		navigator.clipboard
			.writeText(text)
			.then(() => {
				setIsSharing(false);
				alert(t('linkCopied'));
			})
			.catch((err) => {
				console.error('Could not copy text:', err);
			});
	};

	const toggleRuler = (): void => {
		closeOverlayTools();
		const newState = !isRulerEnabled;
		setIsRulerEnabled(newState);
		setRulerEnabled(newState);

		if (!newState) {
			if (rulerLayerRef.current) {
				map.removeLayer(rulerLayerRef.current);
				rulerLayerRef.current = null;
			}

			rulerMarkerRef.current.forEach((marker) => {
				const m = marker as L.Marker & { tooltip?: L.Tooltip };
				if (m.tooltip) {
					map.removeLayer(m.tooltip);
				}
				map.removeLayer(marker);
			});
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

			map.off('click', handleRulerClick);
		} else {
			map.on('click', handleRulerClick);
		}
	};

	const handleRulerClick = (e: L.LeafletMouseEvent): void => {
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
		}

		const marker = L.marker(resolvedLatLng, {
			icon: L.divIcon({
				className: 'ruler-point',
				html: '<div class="w-3 h-3 bg-(--cldt-blue) rounded-full"></div>',
				iconSize: [12, 12],
				iconAnchor: [6, 6],
			}),
		}).addTo(map);

		const pointData = { latlng: resolvedLatLng, distanceFromStart };
		rulerMarkerRef.current.push(marker);
		rulerPointDataRef.current.push(pointData);

		const points = rulerMarkerRef.current.map((m) => m.getLatLng());

		if (rulerLayerRef.current) {
			rulerLayerRef.current.setLatLngs(points);
		} else {
			rulerLayerRef.current = L.polyline(points, {
				color: '--cldt-blue',
				weight: 3,
				opacity: 0.7,
				dashArray: '5, 10',
			}).addTo(map);
		}

		if (rulerPointDataRef.current.length >= 2) {
			const [dataA, dataB] = rulerPointDataRef.current;
			const hasTrail = enhancedTrailPoints && enhancedTrailPoints.length > 0;
			const distA = dataA.distanceFromStart;
			const distB = dataB.distanceFromStart;
			const distanceBetween = hasTrail ? Math.abs(distB - distA) : calculateTrailMetadata(points).totalDistance;

			const ptA = points[0];
			const ptB = points[1];
			const midPoint = L.latLng((ptA.lat + ptB.lat) / 2, (ptA.lng + ptB.lng) / 2);

			const fmt = (meters: number): string => formatDistance(meters / 1000, units, distancePrecisionState, false);
			const content = `<div class="distance-tooltip-content">
                <div>${t('pointA')}: ${fmt(distA)}</div>
                <div>${t('pointB')}: ${fmt(distB)}</div>
                <div><strong>${t('rulerDistance')}: ${fmt(distanceBetween)}</strong></div>
            </div>`;

			rulerTooltipRef.current = L.tooltip({
				permanent: true,
				direction: 'top',
				offset: L.point(0, -60),
				className: 'map-tooltip',
			})
				.setLatLng(midPoint)
				.setContent(content)
				.addTo(map);

			if (rulerSegmentHighlightRef.current) {
				map.removeLayer(rulerSegmentHighlightRef.current);
				rulerSegmentHighlightRef.current = null;
			}
			if (hasTrail && enhancedTrailPoints) {
				const minDist = Math.min(distA, distB);
				const maxDist = Math.max(distA, distB);
				const segmentPoints = enhancedTrailPoints
					.filter(
						(p: EnhancedTrailPoint) => p.distanceFromStart >= minDist - 0.1 && p.distanceFromStart <= maxDist + 0.1,
					)
					.sort((a: EnhancedTrailPoint, b: EnhancedTrailPoint) => a.distanceFromStart - b.distanceFromStart)
					.map((p: EnhancedTrailPoint) => L.latLng(p.lat, p.lng));
				if (segmentPoints.length >= 2) {
					rulerSegmentHighlightRef.current = L.polyline(segmentPoints, {
						color: 'var(--cldt-blue)',
						weight: 5,
					}).addTo(map);
				}
			}
		}
	};

	useEffect(() => {
		if (!rulerTooltipRef.current || rulerPointDataRef.current.length < 2) {
			return;
		}
		const [dataA, dataB] = rulerPointDataRef.current;
		const enhancedTrailPoints = useStore.getState().enhancedTrailPoints;
		const hasTrail = enhancedTrailPoints && enhancedTrailPoints.length > 0;
		const points = rulerMarkerRef.current.map((m) => m.getLatLng());
		const distanceBetween = hasTrail
			? Math.abs(dataB.distanceFromStart - dataA.distanceFromStart)
			: calculateTrailMetadata(points).totalDistance;
		const fmt = (meters: number): string => formatDistance(meters / 1000, units, distancePrecisionState, false);
		const content = `<div class="distance-tooltip-content">
            <div>${t('pointA')}: ${fmt(dataA.distanceFromStart)}</div>
            <div>${t('pointB')}: ${fmt(dataB.distanceFromStart)}</div>
            <div><strong>${t('rulerDistance')}: ${fmt(distanceBetween)}</strong></div>
        </div>`;
		rulerTooltipRef.current.setContent(content);
	}, [units, distancePrecisionState, t]);

	const toggleColorAdjust = (): void => {
		setIsColorAdjustEnabled((prev) => !prev);
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
							const geoJsonBoundary = {
								type: 'FeatureCollection',
								features: [
									{
										type: 'Feature',
										properties: {},
										geometry: geoData.geojson,
									},
								],
							} as GeoJSON.FeatureCollection;

							const boundary = L.geoJSON(geoJsonBoundary, {
								style: function () {
									return {
										color: '#00a6c7',
										weight: 3,
										opacity: 0.9,
										fillColor: 'transparent',
										fillOpacity: 0,
										fill: false,
									};
								},
								onEachFeature: function (feature, layer) {
									let tooltip: L.Tooltip;

									layer.on('mouseover', function (e) {
										const latlng = e.latlng || map.getCenter();

										tooltip = L.tooltip({
											permanent: false,
											direction: 'top',
											className: 'border-tooltip',
											offset: [0, -5],
										})
											.setLatLng(latlng)
											.setContent(t('borderOfCroatia'))
											.addTo(map);
									});

									layer.on('mouseout', function () {
										if (tooltip) {
											map.removeLayer(tooltip);
										}
									});

									layer.on('mousemove', function (e) {
										if (tooltip) {
											tooltip.setLatLng(e.latlng);
										}
									});
								},
							});

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
				const _boundaryCanvasModule = await import('leaflet-boundary-canvas');
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

				const geoJsonBoundary = {
					type: 'FeatureCollection',
					features: [
						{
							type: 'Feature',
							properties: {},
							geometry: geoData.geojson,
						},
					],
				} as GeoJSON.FeatureCollection;

				if (L.TileLayer.BoundaryCanvas && !cancelled) {
					const boundaryLayer = new L.TileLayer.BoundaryCanvas(urlTemplate, {
						boundary: geoJsonBoundary,
						attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
						maxZoom: 19,
						subdomains: 'abc',
					});

					map.eachLayer((layer) => {
						if (layer instanceof L.TileLayer && !(layer instanceof L.TileLayer.BoundaryCanvas)) {
							map.removeLayer(layer);
						}
					});

					boundaryCanvasLayerRef.current = boundaryLayer;
					boundaryLayer.addTo(map);

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
	}, [map, setShowTileBoundary, storeShowTileBoundary]);

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
		[map],
	);

	return (
		<>
			{process.env.NODE_ENV === 'development' && (
				<MapControlsTestLink containerRef={testLinkRef} label={t('testStore')} />
			)}

			<div
				className="map-controls-top-row z-controls absolute top-[58px] right-2 flex flex-col gap-2"
				ref={topRightControlsRef}
			>
				<SmartTooltip
					content={t('directionTooltip', {
						direction: direction === 'SOBO' ? t('directionSouthbound') : t('directionNorthbound'),
					})}
					position="left"
				>
					<button
						aria-label={t('directionTooltip', {
							direction: direction === 'SOBO' ? t('directionSouthbound') : t('directionNorthbound'),
						})}
						className="text-cldt-blue hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-gray-200 bg-white shadow-md transition-all outline-none hover:border-2 focus-visible:border-2"
						title={`Change Direction (Currently ${direction === 'SOBO' ? t('directionTitleNorthSouth') : t('directionTitleSouthNorth')})`}
						type="button"
						onClick={toggleDirection}
					>
						{direction === 'SOBO' ? (
							<IoArrowDownOutline aria-hidden className="h-5 w-5" />
						) : (
							<IoArrowUpOutline aria-hidden className="h-5 w-5" />
						)}
					</button>
				</SmartTooltip>

				<SmartTooltip
					content={t('unitsTooltip', {
						units: units === 'metric' ? t('unitsMetric') : t('unitsImperial'),
					})}
					position="left"
				>
					<button
						aria-label={t('unitsTooltip', { units: units === 'metric' ? t('unitsMetric') : t('unitsImperial') })}
						className="text-cldt-blue-contrast hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-gray-200 bg-white font-semibold shadow-md transition-all outline-none hover:border-2 focus-visible:border-2"
						type="button"
						onClick={toggleUnits}
					>
						<span aria-hidden="true">{units === 'metric' ? 'km' : 'mi'}</span>
					</button>
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

				<MapControlButton
					active={isShowingBoundary}
					ariaLabel={isShowingBoundary ? t('boundaryHide') : t('boundaryShow')}
					content={isShowingBoundary ? t('boundaryHide') : t('boundaryShow')}
					onClick={toggleBoundary}
				>
					<IoMapOutline aria-hidden className="h-5 w-5" />
				</MapControlButton>

				<MapControlButton
					active={isRulerEnabled}
					ariaLabel={isRulerEnabled ? t('rulerDisable') : t('rulerEnable')}
					content={isRulerEnabled ? t('rulerDisable') : t('rulerEnable')}
					onClick={toggleRuler}
				>
					<IoCreateOutline aria-hidden className="h-5 w-5" />
				</MapControlButton>

				<MapControlButton
					active={showTilesBoundary}
					ariaLabel={showTilesBoundary ? t('tilesDisable') : t('tilesEnable')}
					content={showTilesBoundary ? t('tilesDisable') : t('tilesEnable')}
					onClick={toggleTilesBoundary}
				>
					<IoGridOutline aria-hidden className="h-5 w-5" />
				</MapControlButton>

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
					showSections={showSections}
					tooltipHide={t('preferencesHide')}
					tooltipShow={t('preferencesShow')}
					onToggle={() => {
						if (!isSettingsExpanded) {
							setIsPrecisionExpanded(false);
							setIsColorAdjustEnabled(false);
							setIsSharing(false);
						}
						setIsSettingsExpanded((prev) => !prev);
					}}
				/>

				<div className="mx-auto my-1 h-[2px] w-8 bg-(--cldt-blue)" />

				<MapControlButton
					ariaLabel={canShare ? t('shareMap') : t('shareUnavailable')}
					content={canShare ? t('shareMap') : t('shareUnavailable')}
					disabled={!canShare}
					onClick={canShare ? handleShare : undefined}
				>
					<IoShareSocialOutline aria-hidden className="h-5 w-5" />
				</MapControlButton>
			</div>

			{isSharing && (
				<MapControlsSharePanel
					copyToClipboard={copyToClipboard}
					getShareProgressUrl={getShareProgressUrl}
					getShareViewUrl={getShareViewUrl}
					sharePopupRef={sharePopupRef}
					onClose={() => setIsSharing(false)}
				/>
			)}
		</>
	);
};

export default MapControls;
