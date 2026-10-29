'use client';

/**
 * Map overlay panel: direction/units, boundary toggles, share links, settings (precision, dark mode, etc.),
 * and optional test link. Uses useBlockMapPropagation so clicks don't drag the map.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useBlockMapPropagation, usePanel, usePanelManager, useRuler } from '@/hooks';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import {
	useMapStore,
	useStore,
	type MapStoreState,
	type StoreState,
	type TrailDirection,
	type UnitSystem,
} from '@/lib/store';
import { buildShareProgressUrl, buildShareViewUrl, collectShareMapStyleParams, getShareBaseUrl } from '@/lib/share-url';
import { isInCroatiaBbox } from '@/lib/geo-bounds';
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
import { SettingsPanel } from './settings/SettingsPanel';
import { MapControlsToolsPanel } from './MapControlsToolsPanel';
import { MapControlsTestLink } from './MapControlsTestLink';
import { MapControlsSharePanel } from './MapControlsSharePanel';
import { StagePlannerPanel } from './stage-planner/StagePlannerPanel';
import { MapControlsProgressPanel } from './MapControlsProgressPanel';
import { MapControlsHelpPanel } from './MapControlsHelpPanel';
import { MapControlsEmergencyButton } from './MapControlsEmergencyButton';
import { PoiListPanel } from './poi-list/PoiListPanel';
import { MapControlsEmergencyPanel } from './MapControlsEmergencyPanel';
import { prefetchEmergencyData } from '@/lib/emergency-data';
import { toTravelKm } from '@/lib/trail-frame';
import { loadCroatiaBoundary } from '@/lib/croatia-boundary';
import { loadBaseMapClip } from '@/lib/services/base-map-layer';
import { captureMapImage, fitMapToRulerBounds, waitForTilesLoaded } from '@/lib/export-utils';
import { downloadBlob } from '@/lib/download';

/** `borderLabel` is read on each hover, so the tooltip follows a language change. */
function createCroatiaBoundaryLayer(
	map: L.Map,
	borderLabel: () => string,
	boundary: GeoJSON.FeatureCollection,
): L.GeoJSON {
	return L.geoJSON(boundary, {
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
					.setContent(borderLabel())
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
	const tExport = useTranslations('mapExport');
	const borderLabelRef = useRef('');
	useEffect(() => {
		borderLabelRef.current = t('borderOfCroatia');
	}, [t]);
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

	// A boolean, not the fix: the controls (and every panel inside them) would
	// otherwise re-render on each published GPS fix.
	const hasUserLocationInBounds = useMapStore(
		(state: MapStoreState) =>
			state.userLocation !== null &&
			state.permissionStatus === 'granted' &&
			isInCroatiaBbox(state.userLocation.lat, state.userLocation.lng),
	);
	const largeTouchTargets = useMapStore((state: MapStoreState) => state.largeTouchTargets);
	const highlightedTrailPoint = useStore((state: StoreState) => state.highlightedTrailPoint);

	const canShare = hasUserLocationInBounds || !!highlightedTrailPoint;

	const boundaryLayerRef = useRef<L.GeoJSON | null>(null);

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
	const gpxLoadFailed = useStore((state: StoreState) => state.gpxLoadFailed);
	// Pending PNG-export timer; cleared on unmount so a late capture can't run
	// against a torn-down map container.
	const pngExportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (pngExportTimerRef.current) clearTimeout(pngExportTimerRef.current);
		},
		[],
	);

	// Warm the SW cache for emergency JSONs so the panel opens instantly offline.
	useEffect(() => {
		void prefetchEmergencyData();
	}, []);

	const toggleDirection = (): void => {
		closePanel();
		const newDirection = direction === 'SOBO' ? 'NOBO' : 'SOBO';
		setDirection(newDirection);
		onToggleDirection(newDirection);
	};

	const toggleUnits = (): void => {
		closePanel();
		const newUnits = units === 'metric' ? 'imperial' : 'metric';
		setUnits(newUnits);
		onToggleUnits(newUnits);
	};

	// Showing or hiding the outline only adds/removes one overlay layer: the
	// viewport is left exactly where the user had it. Fitting the map to the
	// country bounds here used to zoom the whole view out to Croatia on the
	// first activation, which also forced every zoom-driven layer (tiles, POI
	// and distance markers, junctions) to re-render as if the map had reloaded.
	// The layer is built once and re-added on later toggles; the outline itself is
	// fetched and parsed once per page (loadCroatiaBoundary).
	const toggleBoundary = (): void => {
		closePanel();
		const shouldShow = !showBoundary;
		setShowBoundary(shouldShow);

		if (shouldShow) {
			if (!boundaryLayerRef.current) {
				loadCroatiaBoundary()
					.then((boundary) => {
						// Switched off again while loading, or built by the mount effect meanwhile.
						if (!useMapStore.getState().showBoundary || boundaryLayerRef.current) return;
						const layer = createCroatiaBoundaryLayer(map, () => borderLabelRef.current, boundary);
						boundaryLayerRef.current = layer;
						layer.addTo(map);
					})
					.catch((error: unknown) => console.error('Error creating boundary:', error));
			} else {
				boundaryLayerRef.current.addTo(map);
			}
		} else if (boundaryLayerRef.current) {
			map.removeLayer(boundaryLayerRef.current);
		}
	};

	// BaseMapLayer draws the clipped copy once the flag is on. Turning clipping on
	// loads what that needs first, so a failure shows here and the setting stays off.
	const toggleTilesBoundary = async (): Promise<void> => {
		const shouldShow = !showTileBoundary;
		if (shouldShow) {
			try {
				await loadBaseMapClip();
			} catch (error) {
				console.error('Error enabling tile clipping:', error);
				showErrorToast(t('tileBoundaryError'));
				return;
			}
		}
		setShowTileBoundary(shouldShow, { userInitiated: true });
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

		// Links carry travel km under `dir`; the store points are SOBO.
		if (highlightedTrailPoint) {
			const kmFromStart = toTravelKm(highlightedTrailPoint.distanceFromStart / 1000, direction, totalKm);
			return buildShareProgressUrl(getShareBaseUrl(), {
				kmFromStart,
				direction: direction,
				zoom,
				...styleParams,
			});
		}

		if (closestPoint) {
			const kmFromStart = toTravelKm(closestPoint.distanceFromStart / 1000, direction, totalKm);
			return buildShareProgressUrl(getShareBaseUrl(), {
				kmFromStart,
				direction: direction,
				zoom,
				...styleParams,
			});
		}

		return null;
	};

	const [errorToast, setErrorToast] = useState<string | null>(null);
	const errorToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** Shows `message` in the top-right alert chip for a few seconds. */
	const showErrorToast = (message: string): void => {
		setErrorToast(message);
		if (errorToastTimeoutRef.current) clearTimeout(errorToastTimeoutRef.current);
		errorToastTimeoutRef.current = setTimeout(() => {
			setErrorToast(null);
			errorToastTimeoutRef.current = null;
		}, 4000);
	};
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
			if (errorToastTimeoutRef.current) clearTimeout(errorToastTimeoutRef.current);
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
			fitMapToRulerBounds(map, rulerRange, enhancedTrailPoints, { animate: false });
		}
		if (pngExportTimerRef.current) clearTimeout(pngExportTimerRef.current);
		// Short defer lets the panel close and the ruler refit apply; the real
		// tile-load wait happens inside via waitForTilesLoaded so the screenshot
		// is never taken over blank tiles.
		pngExportTimerRef.current = setTimeout(async () => {
			pngExportTimerRef.current = null;
			try {
				const { toBlob } = await import('html-to-image');
				const mapEl = document.querySelector<HTMLElement>('.leaflet-container');
				if (!mapEl) return;
				map.invalidateSize({ animate: false });
				await waitForTilesLoaded(map);
				const blob = await captureMapImage(mapEl, toBlob);
				if (!blob) throw new Error('The capture returned no image');
				downloadBlob(blob, 'cldt-map.png', 'image/png');
			} catch (err) {
				console.error('PNG export failed:', err instanceof Error ? err.message : String(err));
				showErrorToast(tExport('pngFailed'));
			}
		}, 150);
	};

	useEffect(() => {
		if (!showBoundary || boundaryLayerRef.current || !map) return;
		// Delay lets the map container settle before drawing the boundary. The run is
		// cancelled on re-run/unmount and the ref is re-checked once the outline has
		// loaded: without both guards a pending run from before (a quick hide and show)
		// could add a duplicate, orphaned layer.
		let cancelled = false;
		const boundaryTimerId = setTimeout(() => {
			loadCroatiaBoundary()
				.then((boundary) => {
					if (cancelled || boundaryLayerRef.current) return;
					const layer = createCroatiaBoundaryLayer(map, () => borderLabelRef.current, boundary);
					boundaryLayerRef.current = layer;
					layer.addTo(map);
				})
				.catch((error: unknown) => console.error('Error initializing boundary:', error));
		}, 300);
		return () => {
			cancelled = true;
			clearTimeout(boundaryTimerId);
		};
	}, [showBoundary, map]);

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

	// Unmount cleanup for the border outline, the one layer this component owns.
	// Ruler teardown lives in useRuler, the base layer in BaseMapLayer.
	useEffect(
		() => () => {
			if (boundaryLayerRef.current) {
				map.removeLayer(boundaryLayerRef.current);
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
				<PoiListPanel
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
							showRadarOverlay={showRadarOverlay}
							showTilesBoundary={showTileBoundary}
							onToggleRadarOverlay={() => setShowRadarOverlay(!showRadarOverlay)}
							onToggleTilesBoundary={toggleTilesBoundary}
						/>
					)}
				</div>

				<SettingsPanel
					containerRef={settingsContainerRef}
					isExpanded={settingsPanel.isOpen}
					onToggle={settingsPanel.toggle}
				/>

				<div className="relative inline-block w-10 shrink-0" data-tour="planner" ref={stagePlannerRef}>
					<MapControlsButton
						active={stagePlannerPanel.isOpen}
						ariaLabel={stagePlannerPanel.isOpen ? t('stagePlannerHide') : t('stagePlannerShow')}
						content={stagePlannerPanel.isOpen ? t('stagePlannerHide') : t('stagePlannerShow')}
						onClick={stagePlannerPanel.toggle}
					>
						<IoCalendarOutline aria-hidden className="h-5 w-5" />
					</MapControlsButton>
					{stagePlannerPanel.isOpen && <StagePlannerPanel />}
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

				<div className="relative inline-block w-10 shrink-0" data-tour="help" ref={helpRef}>
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
					{errorToast && (
						<div
							aria-live="assertive"
							className="map-tooltip map-tooltip--pwa animate-slide-in-from-top fixed top-4 right-4 z-[var(--z-toast)] motion-reduce:animate-none"
							role="alert"
						>
							<p className="font-medium">{errorToast}</p>
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
