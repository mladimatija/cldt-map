'use client';

/** Dropdown to switch base map layer (OSM, Topo, Satellite, etc.); syncs with the persisted store. */
import React, { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { BaseMapProvider } from '@/lib/services/base-map-provider';
import { createBaseMapLayer } from '@/lib/services/base-map-layer';
import { isBaseTilePane } from '@/lib/leaflet-panes';
import { useBlockMapPropagation, useMapStore, usePanel } from '@/hooks';
import { useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { config } from '@/lib/config';
import { cn } from '@/lib/utils';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Button } from '@/components/ui/Button';
import { useTranslations } from 'next-intl';
import { PROVIDER_TO_KEY, mapOptions, resolveProvider } from './base-map-options';
import { DARK_PANEL } from './controls/map-controls-constants';

/** Style shown when the stored one is not a known style. */
const FALLBACK_PROVIDER = resolveProvider(config.baseMapProvider, BaseMapProvider.OPEN_STREET_MAP);

/**
 * Puts the layer for `provider` in place of the base tile layers, the clipped
 * copy MapControls builds included; overlays (radar, Waymarked Trails) stay.
 */
function replaceBaseLayer(map: L.Map, provider: BaseMapProvider): void {
	const layer = createBaseMapLayer(provider);
	map.eachLayer((existing) => {
		if (existing instanceof L.TileLayer && isBaseTilePane(existing.options.pane)) map.removeLayer(existing);
	});
	layer.addTo(map);
}

export default function BaseMapSelector(): React.ReactElement {
	const t = useTranslations('baseMapSelector');

	const map = useMap();
	const storedProvider = useMapStore((state: MapStoreState) => state.baseMapProvider);
	const setBaseMapProvider = useMapStore((state: MapStoreState) => state.setBaseMapProvider);
	const gpxLoadFailed = useStore((state: StoreState) => state.gpxLoadFailed);
	const currentLayer = resolveProvider(storedProvider, FALLBACK_PROVIDER);

	const containerRef = useRef<HTMLDivElement>(null);
	useBlockMapPropagation(containerRef);
	const { isOpen, close, toggle } = usePanel('baseMap', containerRef);

	// Shows the selected style on load and after every change, from this menu or
	// a share link, replacing the previous base layer instead of stacking on it.
	useEffect(() => {
		let cancelled = false;

		const isMapContainerValid = (): boolean => {
			try {
				const container = map.getContainer?.();
				return !!(container?.parentNode && typeof document !== 'undefined' && document.contains(container));
			} catch {
				return false;
			}
		};

		const showLayer = (): void => {
			if (cancelled || !isMapContainerValid()) return;
			try {
				replaceBaseLayer(map, currentLayer);
			} catch (error) {
				console.error('Error setting map layer:', error);
			}
		};

		map.whenReady(showLayer);

		return () => {
			cancelled = true;
		};
	}, [map, currentLayer]);

	// MapControls takes the clipped copy off when tile clipping is switched off;
	// put the plain layer for the selected style back.
	useEffect(() => {
		const restore = (): void => {
			try {
				replaceBaseLayer(map, currentLayer);
			} catch (error) {
				console.error('Error restoring map layer:', error);
			}
		};
		window.addEventListener('restoreBaseMapLayer', restore);
		return () => window.removeEventListener('restoreBaseMapLayer', restore);
	}, [map, currentLayer]);

	const handleMapChange = (provider: BaseMapProvider): void => {
		setBaseMapProvider(provider);
		close();
	};

	const currentLayerName = t(PROVIDER_TO_KEY[currentLayer] ?? 'standard');
	const toggleButton = (
		<Button aria-label={`${currentLayerName} Map Style`} variant="controlRoundDark" onClick={toggle}>
			<div className="flex items-center justify-center">
				{mapOptions.find((option) => option.id === currentLayer)?.icon}
			</div>
		</Button>
	);

	return (
		<div
			className={`z-controls absolute top-2 right-2 ${gpxLoadFailed ? 'pointer-events-none opacity-60' : ''}`}
			ref={containerRef}
		>
			<div className="relative rounded-full bg-white shadow-md">
				{isOpen ? (
					toggleButton
				) : (
					<SmartTooltip content={t('changeMapStyle', { name: currentLayerName })} position="left">
						{toggleButton}
					</SmartTooltip>
				)}

				{isOpen && (
					<div
						className={cn(
							DARK_PANEL,
							'z-controls-popover absolute top-0 right-full mr-2 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg',
						)}
					>
						{mapOptions.map((option) => {
							const optionName = t(PROVIDER_TO_KEY[option.id] ?? 'standard');
							const optionDescription = t(`${PROVIDER_TO_KEY[option.id] ?? 'standard'}Description`);
							const isActive = option.id === currentLayer;
							return (
								<Button
									aria-label={`${optionName} - ${optionDescription}`}
									className="base-map-option"
									key={option.id}
									title={optionName}
									variant={isActive ? 'mapOptionActive' : 'mapOption'}
									onClick={() => handleMapChange(option.id)}
								>
									<div
										className={cn(
											'flex h-6 w-6 items-center justify-center',
											option.id === currentLayer ? 'text-cldt-blue dark:text-cldt-blue' : 'dark:text-white',
										)}
									>
										{option.icon}
									</div>
									<div className="flex flex-col">
										<span className="text-sm font-medium dark:text-white">{optionName}</span>
										<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{optionDescription}</span>
									</div>
								</Button>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
