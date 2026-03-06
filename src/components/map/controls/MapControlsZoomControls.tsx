'use client';

/** Zoom +/- and fit-to-route buttons. Fit-to-route fires a custom event; TrailRoute listens and calls map.fitBounds. */
import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { useBlockMapPropagation } from '@/hooks';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { IoAddOutline, IoRemoveOutline, IoExpandOutline } from 'react-icons/io5';
import { MdFullscreen, MdFullscreenExit } from 'react-icons/md';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Button } from '@/components/ui/Button';
import { useTranslations } from 'next-intl';
import { dispatchMapFullscreenToggle } from '@/lib/map-events';

/** Event name listened to by TrailRoute to fit the map bounds to the trail. */
const FIT_ROUTE_EVENT = 'fitMapToRoute';

function dispatchFitMapToRoute(): void {
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(FIT_ROUTE_EVENT));
	}
}

export default function MapControlsZoomControls(): React.ReactElement {
	const t = useTranslations('zoomControls');
	const map = useMap();
	const containerRef = useRef<HTMLDivElement>(null);
	useBlockMapPropagation(containerRef);
	const isFullscreen = useMapStore((state: MapStoreState) => state.isMapFullscreen);
	const gpxLoaded = useMapStore((state: MapStoreState) => state.gpxLoaded);
	const gpxLoadFailed = useMapStore((state: MapStoreState) => state.gpxLoadFailed);
	const [mapZoom, setMapZoom] = useState(map.getZoom());

	const handleZoomChange = useCallback((): void => {
		setMapZoom(map.getZoom());
	}, [map]);

	useEffect(() => {
		map.on('zoomend', handleZoomChange);
		return () => {
			map.off('zoomend', handleZoomChange);
		};
	}, [map, handleZoomChange]);

	const zoomIn = (): void => {
		map.zoomIn();
	};

	const zoomOut = (): void => {
		map.zoomOut();
	};

	const fitToRoute = (): void => {
		dispatchFitMapToRoute();
	};

	return (
		<div
			className={`z-controls absolute bottom-2 left-2 flex flex-col gap-2 ${gpxLoadFailed ? 'pointer-events-none opacity-60' : ''}`}
			ref={containerRef}
		>
			<SmartTooltip content={t('zoomIn')} position="right">
				<Button aria-label={t('zoomIn')} variant="controlRound" onClick={zoomIn}>
					<IoAddOutline aria-hidden className="h-5 w-5" />
				</Button>
			</SmartTooltip>

			<SmartTooltip content={t('zoomLevel', { level: mapZoom })} position="right">
				<Button aria-label={t('zoomLevel', { level: mapZoom })} variant="controlRound" onClick={() => null}>
					<span aria-hidden>
						Z{Math.floor(mapZoom)}
						{mapZoom % 1 !== 0 ? '+' : ''}
					</span>
				</Button>
			</SmartTooltip>

			<SmartTooltip content={t('zoomOut')} position="right">
				<Button aria-label={t('zoomOut')} variant="controlRound" onClick={zoomOut}>
					<IoRemoveOutline aria-hidden className="h-5 w-5" />
				</Button>
			</SmartTooltip>

			<SmartTooltip content={gpxLoaded ? t('fitToRoute') : t('loadRouteFirst')} position="right">
				<Button aria-label={t('fitToRoute')} disabled={!gpxLoaded} variant="controlRound" onClick={fitToRoute}>
					<IoExpandOutline aria-hidden className="h-5 w-5" />
				</Button>
			</SmartTooltip>

			<SmartTooltip content={isFullscreen ? t('exitFullscreen') : t('fullscreen')} position="right">
				<Button
					aria-label={isFullscreen ? t('exitFullscreen') : t('fullscreen')}
					aria-pressed={isFullscreen}
					variant="controlRound"
					onClick={dispatchMapFullscreenToggle}
				>
					{isFullscreen ? (
						<MdFullscreenExit aria-hidden className="h-5 w-5" />
					) : (
						<MdFullscreen aria-hidden className="h-5 w-5" />
					)}
				</Button>
			</SmartTooltip>
		</div>
	);
}

export { FIT_ROUTE_EVENT };
