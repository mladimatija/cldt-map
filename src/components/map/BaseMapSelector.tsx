'use client';

/** Dropdown to switch base map layer (OSM, Topo, Satellite, etc.); syncs with MapService and persisted store. */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { BaseMapProvider } from '@/lib/services/map-service';
import { useMapService, useBlockMapPropagation, useMapStore } from '@/hooks';
import type { MapStoreState } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { TileLayer } from 'leaflet';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Button } from '@/components/ui/Button';
import { useTranslations } from 'next-intl';
import { PROVIDER_TO_KEY, mapOptions, resolveProvider } from './base-map-options';
import { DARK_PANEL } from './controls/map-controls-constants';

let L: typeof import('leaflet') | null = null;

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
			setCurrentLayer(resolved);
		}
	}, [storedProvider, currentLayer, initialProvider]);

	const [isOpen, setIsOpen] = useState(false);
	const [leafletLoaded, setLeafletLoaded] = useState(false);
	const { getService, initializeServices } = useMapService();
	const containerRef = useRef<HTMLDivElement>(null);
	useBlockMapPropagation(containerRef);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				setIsOpen(false);
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const handleClickOutside = (e: MouseEvent): void => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isOpen]);

	useEffect(() => {
		if (isBrowser && !L) {
			import('leaflet')
				.then((leaflet) => {
					L = leaflet;
					setLeafletLoaded(true);
				})
				.catch((err) => {
					console.error('Failed to load Leaflet:', err);
				});
		} else if (isBrowser && L) {
			setLeafletLoaded(true);
		}
	}, [isBrowser]);

	const createFallbackLayer = useCallback(
		(provider: BaseMapProvider): TileLayer | null => {
			if (!isBrowser || !L) {
				return null;
			}

			console.warn(`Creating fallback layer for ${provider}`);

			switch (provider) {
				case BaseMapProvider.SATELLITE:
					try {
						return L.tileLayer(
							'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
							{
								attribution:
									'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USES, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
								maxZoom: 18,
								subdomains: '', // Explicitly set empty string instead of undefined
								noWrap: false, // Prevent wrapping issues
							},
						);
					} catch (error) {
						console.error('Error creating Satellite layer:', error);
						return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
							attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
							maxZoom: 19,
							subdomains: 'abc',
							detectRetina: true,
						});
					}

				case BaseMapProvider.TERRAIN:
					try {
						return L.tileLayer(
							'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
							{
								attribution: 'Tiles &copy; Esri &mdash; Source: USGS, Esri, TANA, DeLorme, and NPS',
								minZoom: 0,
								maxZoom: 16,
								noWrap: false,
							},
						);
					} catch (error) {
						console.error('Error creating Terrain layer:', error);
						return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
							attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
							maxZoom: 19,
							subdomains: 'abc',
							detectRetina: true,
						});
					}

				case BaseMapProvider.OPEN_TOPO_MAP:
					return L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
						attribution:
							'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="https://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
						maxZoom: 17,
						subdomains: 'abc',
						detectRetina: true,
					});

				case BaseMapProvider.CYCL_OSM:
					return L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
						attribution:
							'&copy; <a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases" title="CyclOSM - Open Bicycle render">CyclOSM</a> | Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
						maxZoom: 18,
						subdomains: 'abc',
						detectRetina: true,
					});

				case BaseMapProvider.CROATIA_TOPO:
					return L.tileLayer.wms('https://geoportal.dgu.hr/services/tk/wms', {
						layers: 'TK25',
						format: 'image/png',
						transparent: true,
						version: '1.3.0',
						attribution: '&copy; <a href="https://dgu.gov.hr/">Državna geodetska uprava</a>',
						maxZoom: 19,
					});

				case BaseMapProvider.DARK:
					return L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
						attribution:
							'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
						maxZoom: 20,
						subdomains: 'abcd',
						detectRetina: true,
					});

				default:
					return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
						attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
						maxZoom: 19,
						subdomains: 'abc',
						detectRetina: true,
					});
			}
		},
		[isBrowser],
	);

	useEffect(() => {
		if (!isBrowser || !L || !leafletLoaded || !map) {
			return;
		}

		let cancelled = false;

		const isMapContainerValid = (): boolean => {
			try {
				const container = map.getContainer?.();
				return !!(container?.parentNode && typeof document !== 'undefined' && document.contains(container));
			} catch {
				return false;
			}
		};

		const providerToAdd = effectiveInitial;
		const addInitialLayer = (): void => {
			if (cancelled || !L) return;
			if (!isMapContainerValid()) return;
			try {
				initializeServices();
				const layer = createFallbackLayer(providerToAdd);
				if (layer && !cancelled && isMapContainerValid()) {
					layer.addTo(map);
				} else {
					throw new Error(`Failed to create layer for ${providerToAdd}`);
				}
			} catch (error) {
				if (cancelled) return;
				console.error('Error setting initial map layer:', error);
				try {
					const fallbackLayer = createFallbackLayer(BaseMapProvider.OPEN_STREET_MAP);
					if (fallbackLayer && !cancelled && isMapContainerValid()) {
						fallbackLayer.addTo(map);
					}
				} catch {}
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
	}, [map, initializeServices, isBrowser, createFallbackLayer, leafletLoaded, effectiveInitial]);

	const handleMapChangeRef = useRef<(provider: BaseMapProvider) => void>(() => {});

	const handleMapChange = (provider: BaseMapProvider): void => {
		if (!isBrowser || !L || !leafletLoaded) {
			return;
		}

		try {
			map.eachLayer((layer) => {
				if (L && layer instanceof L.TileLayer && layer.options.pane !== 'radarPane') {
					map.removeLayer(layer);
				}
			});

			console.warn(`Creating layer for provider: ${provider}`);

			let newLayer: TileLayer | null = null;

			try {
				const service = getService(provider);

				if (service) {
					const options = {
						attribution: service.attribution || '',
						maxZoom: service.maxZoom || 18,
						minZoom: service.minZoom || 0,
						subdomains: service.subdomains || '',
						bounds: service.bounds,
						noWrap: service.noWrap || false,
					};

					if (provider === BaseMapProvider.CROATIA_TOPO) {
						newLayer = L.tileLayer.wms('https://geoportal.dgu.hr/services/tk/wms', {
							layers: 'TK25',
							format: 'image/png',
							transparent: true,
							version: '1.3.0',
							attribution: options.attribution,
							maxZoom: options.maxZoom,
						});
					} else {
						newLayer = L.tileLayer(service.url, options);
					}

					console.warn('Layer created through service:', newLayer);
				} else {
					throw new Error(`Service not found for provider: ${provider}`);
				}
			} catch (serviceError) {
				console.error('Error creating layer through service:', serviceError);
				newLayer = createFallbackLayer(provider);
			}

			if (!newLayer) {
				console.error(`Failed to create layer for provider: ${provider}`);
				const defaultLayer = createFallbackLayer(BaseMapProvider.OPEN_STREET_MAP);
				if (defaultLayer) {
					defaultLayer.addTo(map);
					setCurrentLayer(BaseMapProvider.OPEN_STREET_MAP);
				}
				setIsOpen(false);
				return;
			}

			if (typeof newLayer.addTo !== 'function') {
				console.error('Layer does not have addTo method:', newLayer);
				const fallbackLayer = createFallbackLayer(BaseMapProvider.OPEN_STREET_MAP);
				if (fallbackLayer) {
					fallbackLayer.addTo(map);
					setCurrentLayer(BaseMapProvider.OPEN_STREET_MAP);
				}
				setIsOpen(false);
				return;
			}

			try {
				newLayer.addTo(map);
			} catch (addError) {
				console.error('Error adding layer to map:', addError);
				try {
					const emergencyLayer = createFallbackLayer(BaseMapProvider.OPEN_STREET_MAP);
					if (emergencyLayer) {
						emergencyLayer.addTo(map);
						setCurrentLayer(BaseMapProvider.OPEN_STREET_MAP);
					}
				} catch (e) {
					console.error('Critical error, even emergency fallback failed:', e);
				}
				setIsOpen(false);
				return;
			}

			setCurrentLayer(provider);
			setBaseMapProvider(provider);
			setIsOpen(false);
		} catch (error) {
			console.error('Error changing map layer:', error);
			setIsOpen(false);
		}
	};

	// Keep ref in sync so the event listener below always calls the latest version.
	handleMapChangeRef.current = handleMapChange;

	// When MapControls disables tile boundary it dispatches this event so the correct
	// base layer (not a hardcoded OSM fallback) is restored.
	useEffect(() => {
		const restore = (): void => handleMapChangeRef.current(currentLayer);
		window.addEventListener('restoreBaseMapLayer', restore);
		return () => window.removeEventListener('restoreBaseMapLayer', restore);
	}, [currentLayer]);

	const currentLayerName = t(PROVIDER_TO_KEY[currentLayer] ?? 'standard');
	const toggleButton = (
		<Button
			aria-label={`${currentLayerName} Map Style`}
			variant="controlRoundDark"
			onClick={() => {
				const willOpen = !isOpen;
				if (willOpen) {
					window.dispatchEvent(new CustomEvent('closeMapControlOverlays'));
				}
				setIsOpen(willOpen);
			}}
		>
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
