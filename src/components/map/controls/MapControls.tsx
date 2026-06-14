'use client';

/**
 * Map overlay panel: direction/units, boundary toggles, share links, settings (precision, dark mode, etc.),
 * and optional test link. Uses useBlockMapPropagation so clicks don't drag the map.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useBlockMapPropagation, usePanel, usePanelManager, useRuler } from '@/hooks';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import geoData from '@/../public/data/geoJsonHr.json';
import {
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
	collectShareMapStyleParams,
	getShareBaseUrl,
	isWithinMapBoundary,
} from '@/lib/utils';
import { copyTextToClipboard } from '@/lib/share-link-copy';
import type * as GeoJSON from 'geojson';
import {
	IoArrowDownOutline,
	IoArrowUpOutline,
	IoCalendarOutline,
	IoCheckmarkDoneOutline,
	IoConstructOutline,
	IoHelpCircleOutline,
	IoCreateOutline,
	IoMapOutline,
	IoShareSocialOutline,
} from 'react-icons/io5';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Button } from '@/components/ui/Button';
import { useTranslations } from 'next-intl';
import { MapControlsButton } from './MapControlsButton';
import { MapControlsPrecisionSlider } from './MapControlsPrecisionSlider';
import { MapControlsSettingsPanel } from './MapControlsSettingsPanel';
import { MapControlsToolsPanel } from './MapControlsToolsPanel';
import { MapControlsTestLink } from './MapControlsTestLink';
import { MapControlsSharePanel } from './MapControlsSharePanel';
import { MapControlsStagePlannerPanel } from './MapControlsStagePlannerPanel';
import { MapControlsProgressPanel } from './MapControlsProgressPanel';
import { MapControlsHelpPanel } from './MapControlsHelpPanel';
import { MapControlsEmergencyButton } from './MapControlsEmergencyButton';
import { MapControlsPoiList } from './MapControlsPoiList';
import { MapControlsEmergencyPanel } from './MapControlsEmergencyPanel';
import { prefetchEmergencyData } from '@/lib/emergency-data';
import { fitMapToRulerBounds } from '@/lib/export-utils';

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
	// Only swap out the BASE tile layer (Leaflet's default `tilePane`). Overlay
	// tile layers in custom panes - radar (radarPane), and any future
	// tile-based overlays - must survive the boundary toggle, otherwise enabling
	// boundary-clipping while the radar is on silently strips the radar and the
	// user has to toggle it off + on to get it back.
	map.eachLayer((l) => {
		if (!(l instanceof L.TileLayer) || l instanceof BoundaryCanvasCtor) return;
		// Cast to escape the over-narrowed type produced by the instanceof-exclusion
		// guard above (TS narrows `l` to `never` after the negative BoundaryCanvasCtor
		// check, even though l is still a plain L.TileLayer at runtime).
		const tile = l as L.TileLayer;
		const pane = tile.options.pane;
		if (pane === undefined || pane === 'tilePane') {
			map.removeLayer(tile);
		}
	});
	layer.addTo(map);
	return layer;
}

interface MapControlsProps {
	onToggleDirection?: (direction: TrailDirection) => void;
	onToggleUnits?: (units: UnitSystem) => void;
}

interface ExtendedMap extends L.Map {
	_enforcingBounds?: boolean;
}

const MapControls: React.FC<MapControlsProps> = ({
	onToggleDirection = () => {},
	onToggleUnits = () => {},
}): React.ReactElement => {
	const map = useMap() as ExtendedMap;
	const t = useTranslations('mapControls');
	const [showTilesBoundary, setShowTilesBoundary] = useState(false);
	const [tileBoundaryReinitKey, setTileBoundaryReinitKey] = useState(0);
	const precisionContainerRef = useRef<HTMLDivElement>(null);
	const settingsContainerRef = useRef<HTMLDivElement>(null);
	const poiListContainerRef = useRef<HTMLDivElement>(null);
	const toolsContainerRef = useRef<HTMLDivElement>(null);
	const testLinkRef = useRef<HTMLDivElement>(null);
	const topRightControlsRef = useRef<HTMLDivElement>(null);
	const shareContainerRef = useRef<HTMLDivElement>(null);
	const stagePlannerRef = useRef<HTMLDivElement>(null);
	const progressRef = useRef<HTMLDivElement>(null);
	const helpRef = useRef<HTMLDivElement>(null);
	const emergencyContainerRef = useRef<HTMLDivElement>(null);

	// Each panel registers its container ref with the shared mutual-exclusion
	// manager (state lives in mapStore.openPanel; document listeners installed
	// once in MapContent via usePanelListeners). Opening one closes any other;
	// outside click or Escape close the open panel.
	const precisionPanel = usePanel('precision', precisionContainerRef);
	const toolsPanel = usePanel('tools', toolsContainerRef);
	const settingsPanel = usePanel('settings', settingsContainerRef);
	const sharePanel = usePanel('share', shareContainerRef);
	const stagePlannerPanel = usePanel('stagePlanner', stagePlannerRef);
	const progressPanel = usePanel('progress', progressRef);
	const helpPanel = usePanel('help', helpRef);
	const emergencyPanel = usePanel('emergency', emergencyContainerRef);
	const poiListPanel = usePanel('poiList', poiListContainerRef);

	useBlockMapPropagation(testLinkRef);
	useBlockMapPropagation(topRightControlsRef);
	useBlockMapPropagation(precisionContainerRef);
	useBlockMapPropagation(settingsContainerRef);
	useBlockMapPropagation(poiListContainerRef);
	useBlockMapPropagation(toolsContainerRef);
	useBlockMapPropagation(stagePlannerRef);
	useBlockMapPropagation(progressRef);
	useBlockMapPropagation(helpRef);
	useBlockMapPropagation(emergencyContainerRef);

	const userLocation = useMapStore((state: MapStoreState) => state.userLocation);
	const permissionStatus = useMapStore((state: MapStoreState) => state.permissionStatus);
	const largeTouchTargets = useMapStore((state: MapStoreState) => state.largeTouchTargets);
	const highlightedTrailPoint = useStore((state: StoreState) => state.highlightedTrailPoint);

	const withinMapBoundary = userLocation ? isWithinMapBoundary(userLocation.lat, userLocation.lng) : false;
	const hasUserLocationInBounds = !!userLocation && permissionStatus === 'granted' && withinMapBoundary;
	const canShare = hasUserLocationInBounds || !!highlightedTrailPoint;

	const boundaryLayerRef = useRef<L.GeoJSON | null>(null);
	const boundaryCanvasLayerRef = useRef<L.TileLayer | null>(null);
	const colorAdjustRef = useRef<HTMLElement | null>(null);

	const { close: closePanel } = usePanelManager();
	// All ruler behavior (markers, tooltip, chart bridge, Escape handling)
	// lives in the hook; the component only consumes this surface.
	const { isRulerEnabled, rulerRange, rulerAnnouncement, toggleRuler } = useRuler(map);
	const setDirection = useMapStore((state: MapStoreState) => state.setDirection);
	const setUnits = useMapStore((state: MapStoreState) => state.setUnits);
	const setShowBoundary = useMapStore((state: MapStoreState) => state.setShowBoundary);
	const setShowTileBoundary = useMapStore((state: MapStoreState) => state.setShowTileBoundary);
	const showRadarOverlay = useMapStore((state: MapStoreState) => state.showRadarOverlay);
	const setShowRadarOverlay = useMapStore((state: MapStoreState) => state.setShowRadarOverlay);
	const setDistancePrecision = useMapStore((state: MapStoreState) => state.setDistancePrecision);

	const direction = useMapStore((state: MapStoreState) => state.direction);
	const enhancedTrailPoints = useStore((state: StoreState) => state.enhancedTrailPoints);
	const distancePrecision = useMapStore((state: MapStoreState) => state.distancePrecision);
	const units = useMapStore((state: MapStoreState) => state.units);
	const showBoundary = useMapStore((state: MapStoreState) => state.showBoundary);
	const showTileBoundary = useMapStore((state: MapStoreState) => state.showTileBoundary);
	const baseMapProvider = useMapStore((state: MapStoreState) => state.baseMapProvider);
	const gpxLoadFailed = useMapStore((state: MapStoreState) => state.gpxLoadFailed);
	const prevBaseMapProviderRef = useRef(baseMapProvider);
	// Pending PNG-export timer; cleared on unmount so a late capture can't run
	// against a torn-down map container.
	const pngExportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (pngExportTimerRef.current) clearTimeout(pngExportTimerRef.current);
		},
		[],
	);

	const [colorSettings, setColorSettings] = useState({
		brightness: 100,
		contrast: 100,
		saturation: 100,
	});

	// Warm the SW cache for emergency JSONs so the panel opens instantly offline.
	useEffect(() => {
		void prefetchEmergencyData();
	}, []);

	useEffect(() => {
		const mapElement = document.querySelector('.leaflet-container') as HTMLElement;
		if (!mapElement) {
			return;
		}
		if (toolsPanel.isOpen) {
			mapElement.style.filter = `
                brightness(${colorSettings.brightness}%)
                contrast(${colorSettings.contrast}%)
                saturate(${colorSettings.saturation}%)
            `;
		} else {
			mapElement.style.filter = '';
		}
	}, [toolsPanel.isOpen, colorSettings]);

	useEffect(() => {
		const mapContainer = map?.getContainer();
		if (!mapContainer) {
			return;
		}
		if (toolsPanel.isOpen) {
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
	}, [map, toolsPanel.isOpen]);

	const toggleDirection = (): void => {
		closePanel();
		const newDirection = direction === 'SOBO' ? 'NOBO' : 'SOBO';
		setDirection(newDirection);
		useStore.getState().broadcastDirectionChange(newDirection);
		onToggleDirection(newDirection);
	};

	const toggleUnits = (): void => {
		closePanel();
		const newUnits = units === 'metric' ? 'imperial' : 'metric';
		setUnits(newUnits);
		useStore.getState().broadcastUnitsChange(newUnits);
		onToggleUnits(newUnits);
	};

	const toggleBoundary = (): void => {
		closePanel();
		const shouldShow = !showBoundary;
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

			setTileBoundaryError(
				t('tileBoundaryError', { action: shouldShow ? t('tileBoundaryEnabling') : t('tileBoundaryDisabling') }),
			);
			if (tileBoundaryErrorTimeoutRef.current) clearTimeout(tileBoundaryErrorTimeoutRef.current);
			tileBoundaryErrorTimeoutRef.current = setTimeout(() => {
				setTileBoundaryError(null);
				tileBoundaryErrorTimeoutRef.current = null;
			}, 4000);
		}
	};

	const getShareStyleParams = (): ReturnType<typeof collectShareMapStyleParams> =>
		collectShareMapStyleParams({
			rulerEnabled: isRulerEnabled,
			rulerRange: isRulerEnabled ? rulerRange : null,
		});

	const getShareViewUrl = (): string => {
		const center = map.getCenter();
		return buildShareViewUrl(getShareBaseUrl(), {
			lat: center.lat,
			lng: center.lng,
			zoom: map.getZoom(),
			...getShareStyleParams(),
		});
	};

	const getShareProgressUrl = (): string | null => {
		const state = useStore.getState();
		const closestPoint = state.closestPoint;
		const totalKm = state.trailMetadata?.totalDistance ?? 0;
		if (totalKm <= 0) return null;

		const zoom = map.getZoom();
		const styleParams = getShareStyleParams();

		if (highlightedTrailPoint) {
			const kmFromStart = highlightedTrailPoint.distanceFromStart / 1000;
			return buildShareProgressUrl(getShareBaseUrl(), {
				kmFromStart,
				direction: direction,
				zoom,
				...styleParams,
			});
		}

		if (closestPoint) {
			const kmFromStart = closestPoint.distanceFromStart / 1000;
			return buildShareProgressUrl(getShareBaseUrl(), {
				kmFromStart,
				direction: direction,
				zoom,
				...styleParams,
			});
		}

		return null;
	};

	const [tileBoundaryError, setTileBoundaryError] = useState<string | null>(null);
	const tileBoundaryErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const shareShortLinks = useMapStore((state: MapStoreState) => state.shareShortLinks);
	const [sharePanelUrlSnapshot, setSharePanelUrlSnapshot] = useState<string | null>(null);

	const handleShareButton = (): void => {
		if (sharePanel.isOpen) {
			sharePanel.close();
		} else {
			setSharePanelUrlSnapshot(canShare ? (getShareProgressUrl() ?? getShareViewUrl()) : null);
			sharePanel.open();
		}
	};

	const copyResolvedShareLink = (finalUrl: string, short: boolean): void => {
		void writeShareLinkToClipboard(finalUrl, short, true);
	};

	const writeShareLinkToClipboard = async (finalUrl: string, short: boolean, withText: boolean): Promise<void> => {
		const text = withText ? `${t('shareText')}\n${finalUrl}` : finalUrl;
		const ok = await copyTextToClipboard(text);
		if (ok) {
			useMapStore.getState().showShareCopyToast({ status: 'success', short });
		} else {
			useMapStore.getState().showShareCopyToast({ status: 'error', short: false });
		}
	};

	useEffect(
		() => () => {
			if (tileBoundaryErrorTimeoutRef.current) clearTimeout(tileBoundaryErrorTimeoutRef.current);
		},
		[],
	);

	const handlePrint = (): void => {
		closePanel();
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
		closePanel();
		if (rulerRange && enhancedTrailPoints?.length) {
			fitMapToRulerBounds(map, rulerRange, enhancedTrailPoints);
		}
		if (pngExportTimerRef.current) clearTimeout(pngExportTimerRef.current);
		pngExportTimerRef.current = setTimeout(async () => {
			pngExportTimerRef.current = null;
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
				// Defer revocation one tick: revoking synchronously after click() can
				// abort the download in Safari.
				setTimeout(() => URL.revokeObjectURL(url), 1000);
			} catch (err) {
				console.error('PNG export failed:', err instanceof Error ? err.message : String(err));
			}
		}, 600);
	};

	useEffect(() => {
		useStore.getState().broadcastDirectionChange(direction);
		// Persisted units live in mapStore, but MapControlsUnitsSelector reads from the
		// main useStore UISlice. Propagate on mount so the selector matches reality after
		// a reload with a non-default preference.
		useStore.getState().setUnits(units);
		if (!showBoundary || boundaryLayerRef.current || !map) return;
		// Delay lets the map container settle before drawing the boundary. The timer is
		// cleared on re-run/unmount and the ref is re-checked inside the callback: this
		// effect also re-fires on direction/units/t changes, and without both guards a
		// pending timer from a previous run could add a duplicate, orphaned layer.
		const boundaryTimerId = setTimeout(() => {
			if (boundaryLayerRef.current) return;
			try {
				const boundary = createCroatiaBoundaryLayer(map, t('borderOfCroatia'));
				boundaryLayerRef.current = boundary;
				boundary.addTo(map);
			} catch (error) {
				console.error('Error initializing boundary:', error);
			}
		}, 300);
		return () => clearTimeout(boundaryTimerId);
	}, [direction, units, showBoundary, map, t]);

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

		if (showTileBoundary && boundaryCanvasLayerRef.current) {
			boundaryCanvasLayerRef.current = null;
			setTileBoundaryReinitKey((k) => k + 1);
		}
	}, [baseMapProvider, showTileBoundary]);

	useEffect(() => {
		if (!showTileBoundary || boundaryCanvasLayerRef.current) {
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
	}, [map, setShowTileBoundary, showTileBoundary, tileBoundaryReinitKey]);

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

	// Unmount cleanup for the layers this component still owns (boundary,
	// boundary canvas, color-adjust overlay). Ruler teardown lives in useRuler.
	useEffect(
		() => () => {
			if (boundaryLayerRef.current) {
				map.removeLayer(boundaryLayerRef.current);
			}

			if (boundaryCanvasLayerRef.current) {
				map.removeLayer(boundaryCanvasLayerRef.current);
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

	// Prevent the right-side button stack from overlapping the SOS emergency
	// button on short or rotated viewports. Measures both elements live and
	// applies max-height + overflow-y inline only when an actual overlap is
	// detected; clears the inline styles when there is room. Re-runs on:
	//   - mount and re-mount
	//   - window resize (catches layout changes from browser-chrome show/hide)
	//   - orientationchange (rotation on phones / tablets)
	//   - largeTouchTargets toggle (button sizes change -> stack height changes)
	//   - ResizeObserver on the stack itself (button count changes / fonts load)
	useEffect(() => {
		if (typeof window === 'undefined') return;
		const stack = topRightControlsRef.current;
		const sos = emergencyContainerRef.current;
		if (!stack || !sos) return;

		const GAP_PX = 16;

		const update = (): void => {
			// Clear inline styles first, so we measure the stack's natural height
			// rather than a previously capped one.
			stack.style.maxHeight = '';
			stack.style.overflowY = '';

			const stackRect = stack.getBoundingClientRect();
			const sosRect = sos.getBoundingClientRect();

			if (stackRect.bottom + GAP_PX > sosRect.top) {
				const maxH = Math.max(0, sosRect.top - stackRect.top - GAP_PX);
				stack.style.maxHeight = `${maxH}px`;
				stack.style.overflowY = 'auto';
			}
		};

		// rAF defers the measurement until after the browser has applied any
		// pending layout (e.g., button-size changes from the large-touch-targets
		// toggle), so we read post-change geometry.
		const scheduleUpdate = (): void => {
			requestAnimationFrame(update);
		};

		scheduleUpdate();

		window.addEventListener('resize', scheduleUpdate);
		window.addEventListener('orientationchange', scheduleUpdate);

		const ro = new ResizeObserver(scheduleUpdate);
		ro.observe(stack);
		ro.observe(sos);

		return () => {
			window.removeEventListener('resize', scheduleUpdate);
			window.removeEventListener('orientationchange', scheduleUpdate);
			ro.disconnect();
			// Leave no inline styles behind when the component unmounts.
			stack.style.maxHeight = '';
			stack.style.overflowY = '';
		};
	}, [largeTouchTargets]);

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
				<MapControlsPoiList
					containerRef={poiListContainerRef}
					isExpanded={poiListPanel.isOpen}
					onClose={closePanel}
					onToggle={poiListPanel.toggle}
				/>

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
					isExpanded={precisionPanel.isOpen}
					tooltipContent={t('precisionClick', { value: distancePrecision })}
					tooltipExpanded={t('precisionDrag')}
					value={distancePrecision}
					onChange={setDistancePrecision}
					onToggle={precisionPanel.toggle}
				/>

				<MapControlsButton
					active={showBoundary}
					ariaLabel={showBoundary ? t('boundaryHide') : t('boundaryShow')}
					content={showBoundary ? t('boundaryHide') : t('boundaryShow')}
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

				<div className="relative inline-block w-10 shrink-0" ref={toolsContainerRef}>
					<MapControlsButton
						active={toolsPanel.isOpen}
						ariaLabel={toolsPanel.isOpen ? t('toolsHide') : t('toolsShow')}
						content={toolsPanel.isOpen ? t('toolsHide') : t('toolsShow')}
						onClick={toolsPanel.toggle}
					>
						<IoConstructOutline aria-hidden className="h-5 w-5" />
					</MapControlsButton>
					{toolsPanel.isOpen && (
						<MapControlsToolsPanel
							colorSettings={colorSettings}
							setColorSettings={setColorSettings}
							showRadarOverlay={showRadarOverlay}
							showTilesBoundary={showTilesBoundary}
							onToggleRadarOverlay={() => setShowRadarOverlay(!showRadarOverlay)}
							onToggleTilesBoundary={toggleTilesBoundary}
						/>
					)}
				</div>

				<MapControlsSettingsPanel
					containerRef={settingsContainerRef}
					isExpanded={settingsPanel.isOpen}
					onToggle={settingsPanel.toggle}
				/>

				<div className="relative inline-block w-10 shrink-0" ref={stagePlannerRef}>
					<MapControlsButton
						active={stagePlannerPanel.isOpen}
						ariaLabel={stagePlannerPanel.isOpen ? t('stagePlannerHide') : t('stagePlannerShow')}
						content={stagePlannerPanel.isOpen ? t('stagePlannerHide') : t('stagePlannerShow')}
						onClick={stagePlannerPanel.toggle}
					>
						<IoCalendarOutline aria-hidden className="h-5 w-5" />
					</MapControlsButton>
					{stagePlannerPanel.isOpen && <MapControlsStagePlannerPanel />}
				</div>

				<div className="relative inline-block w-10 shrink-0" ref={progressRef}>
					<MapControlsButton
						active={progressPanel.isOpen}
						ariaLabel={progressPanel.isOpen ? t('progressHide') : t('progressShow')}
						content={progressPanel.isOpen ? t('progressHide') : t('progressShow')}
						onClick={progressPanel.toggle}
					>
						<IoCheckmarkDoneOutline aria-hidden className="h-5 w-5" />
					</MapControlsButton>
					{progressPanel.isOpen && <MapControlsProgressPanel />}
				</div>

				<div className="relative inline-block w-10 shrink-0" ref={helpRef}>
					<MapControlsButton
						active={helpPanel.isOpen}
						ariaLabel={helpPanel.isOpen ? t('helpHide') : t('helpShow')}
						content={helpPanel.isOpen ? t('helpHide') : t('helpShow')}
						onClick={helpPanel.toggle}
					>
						<IoHelpCircleOutline aria-hidden className="h-5 w-5" />
					</MapControlsButton>
					{helpPanel.isOpen && <MapControlsHelpPanel />}
				</div>

				<div className="relative inline-block w-10 shrink-0" ref={shareContainerRef}>
					<MapControlsButton
						active={sharePanel.isOpen}
						ariaLabel={sharePanel.isOpen ? t('shareHide') : canShare ? t('shareShow') : t('shareExportShow')}
						content={sharePanel.isOpen ? t('shareHide') : canShare ? t('shareShow') : t('shareExportShow')}
						onClick={handleShareButton}
					>
						<IoShareSocialOutline aria-hidden className="h-5 w-5" />
					</MapControlsButton>
					{sharePanel.isOpen ? (
						<MapControlsSharePanel
							baseMapProvider={baseMapProvider}
							canShare={canShare}
							longUrl={sharePanelUrlSnapshot}
							useShortLinks={shareShortLinks}
							onCopy={copyResolvedShareLink}
							onPngDownload={handlePngDownload}
							onPrint={handlePrint}
						/>
					) : null}
					{tileBoundaryError && (
						<div
							aria-live="assertive"
							className="map-tooltip map-tooltip--pwa animate-slide-in-from-top fixed top-4 right-4 z-[var(--z-toast)] motion-reduce:animate-none"
							role="alert"
						>
							<p className="font-medium">{tileBoundaryError}</p>
						</div>
					)}
					{rulerAnnouncement && (
						<div aria-live="polite" className="sr-only" role="status">
							{rulerAnnouncement}
						</div>
					)}
				</div>
			</div>

			<div
				className={`map-controls-emergency z-controls absolute right-2 bottom-32 ${controlsDisabledClass}`}
				ref={emergencyContainerRef}
				onContextMenu={(e) => e.preventDefault()}
			>
				<MapControlsEmergencyButton expanded={emergencyPanel.isOpen} onOpen={emergencyPanel.open} />
				{emergencyPanel.isOpen && <MapControlsEmergencyPanel onClose={closePanel} />}
			</div>
		</>
	);
};

export default MapControls;
