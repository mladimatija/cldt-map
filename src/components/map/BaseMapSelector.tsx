'use client';

/** Dropdown to switch base map layer (OSM, Topo, Satellite, etc.); syncs with MapService and persisted store. */
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { BaseMapProvider, MapService } from '@/lib/services/map-service';
import { useBlockMapPropagation, useMapStore, usePanel } from '@/hooks';
import { L } from '@/lib/store/leaflet';
import type { MapStoreState } from '@/lib/store';
import { cn } from '@/lib/utils';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Button } from '@/components/ui/Button';
import { useTranslations } from 'next-intl';
import { PROVIDER_TO_KEY, mapOptions, resolveProvider } from './base-map-options';
import { DARK_PANEL } from './controls/map-controls-constants';

interface BaseMapSelectorProps {
	initialProvider?: BaseMapProvider;
}

export default function BaseMapSelector({ initialProvider }: BaseMapSelectorProps): React.ReactElement {
	const isBrowser = typeof window !== 'undefined';
	const t = useTranslations('baseMapSelector');

	const map = useMap();
	const storedProvider = useMapStore((state: MapStoreState) => state.baseMapProvider);
	const setBaseMapProvider = useMapStore((state: MapStoreState) => state.setBaseMapProvider);
	const gpxLoadFailed = useMapStore((state: MapStoreState) => state.gpxLoadFailed);
	const effectiveInitial = resolveProvider(storedProvider, initialProvider || BaseMapProvider.OPEN_STREET_MAP);
	const [currentLayer, setCurrentLayer] = useState<BaseMapProvider>(effectiveInitial);

	useEffect(() => {
		const resolved = resolveProvider(storedProvider, initialProvider || BaseMapProvider.OPEN_STREET_MAP);
		if (resolved !== currentLayer) {
			queueMicrotask(() => setCurrentLayer(resolved));
		}
	}, [storedProvider, currentLayer, initialProvider]);

	const containerRef = useRef<HTMLDivElement>(null);
	useBlockMapPropagation(containerRef);
	const { isOpen, close, toggle } = usePanel('baseMap', containerRef);

	useEffect(() => {
		if (!isBrowser || !map) {
			return;
		}

		let cancelled = false;
		const service = MapService.getInstance();

		const isMapContainerValid = (): boolean => {
			try {
				const container = map.getContainer?.();
				return !!(container?.parentNode && typeof document !== 'undefined' && document.contains(container));
			} catch {
				return false;
			}
		};

		const addInitialLayer = (): void => {
			if (cancelled || !isMapContainerValid()) return;
			try {
				const layer = service.createBaseMapLayer(effectiveInitial);
				if (!cancelled && isMapContainerValid()) {
					layer.addTo(map);
				}
			} catch (error) {
				if (!cancelled) console.error('Error setting initial map layer:', error);
			}
		};

		if (map.whenReady) {
			map.whenReady(addInitialLayer);
		} else {
			addInitialLayer();
		}

		return () => {
			cancelled = true;
		};
	}, [map, isBrowser, effectiveInitial]);

	const handleMapChangeRef = useRef<(provider: BaseMapProvider) => void>(() => {});

	const handleMapChange = (provider: BaseMapProvider): void => {
		if (!isBrowser) return;

		const service = MapService.getInstance();
		try {
			map.eachLayer((layer) => {
				if (L && layer instanceof L.TileLayer && layer.options.pane !== 'radarPane') {
					map.removeLayer(layer);
				}
			});

			const newLayer = service.createBaseMapLayer(provider);
			newLayer.addTo(map);
			setCurrentLayer(provider);
			setBaseMapProvider(provider);
		} catch (error) {
			console.error('Error changing map layer:', error);
		} finally {
			close();
		}
	};

	// Keep ref in sync so the event listener below always calls the latest version.
	useLayoutEffect(() => {
		handleMapChangeRef.current = handleMapChange;
	});

	// When MapControls disables tile boundary it dispatches this event so the correct
	// base layer (not a hardcoded OSM fallback) is restored.
	useEffect(() => {
		const restore = (): void => handleMapChangeRef.current(currentLayer);
		window.addEventListener('restoreBaseMapLayer', restore);
		return () => window.removeEventListener('restoreBaseMapLayer', restore);
	}, [currentLayer]);

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
