'use client';

/** Dropdown to pick the base map style; BaseMapLayer draws it. Syncs with the persisted store. */
import React, { useRef } from 'react';
import { BaseMapProvider } from '@/lib/services/base-map-provider';
import { useBlockMapPropagation, useMapStore, usePanel } from '@/hooks';
import { useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { cn } from '@/lib/cn';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Button } from '@/components/ui/Button';
import { useTranslations } from 'next-intl';
import { PROVIDER_TO_KEY, mapOptions, selectedBaseMapProvider } from './base-map-options';
import { DARK_PANEL } from './controls/map-controls-constants';

export default function BaseMapSelector(): React.ReactElement {
	const t = useTranslations('baseMapSelector');

	const storedProvider = useMapStore((state: MapStoreState) => state.baseMapProvider);
	const setBaseMapProvider = useMapStore((state: MapStoreState) => state.setBaseMapProvider);
	const gpxLoadFailed = useStore((state: StoreState) => state.gpxLoadFailed);
	const currentLayer = selectedBaseMapProvider(storedProvider);

	const containerRef = useRef<HTMLDivElement>(null);
	useBlockMapPropagation(containerRef);
	const { isOpen, close, toggle } = usePanel('baseMap', containerRef);

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
