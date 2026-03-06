'use client';

import React, { useRef } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { useBlockMapPropagation } from '@/hooks';
import { isWithinMapBoundary } from '@/lib/utils';
import { Tooltip } from '@/components/ui/Tooltip';
import { MdPersonPinCircle } from 'react-icons/md';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';

export default function MapControlsUserLocationToggleButton(): React.ReactElement {
	const t = useTranslations('location');
	const containerRef = useRef<HTMLButtonElement>(null);
	useBlockMapPropagation(containerRef);
	const showUserMarker = useMapStore((state: MapStoreState) => state.showUserMarker);
	const setShowUserMarker = useMapStore((state: MapStoreState) => state.setShowUserMarker);
	const permissionStatus = useMapStore((state: MapStoreState) => state.permissionStatus);
	const userLocation = useMapStore((state: MapStoreState) => state.userLocation);

	const withinMapBoundary = userLocation ? isWithinMapBoundary(userLocation.lat, userLocation.lng) : true;
	const isDisabled = !userLocation || permissionStatus !== 'granted' || !withinMapBoundary;

	const handleClick = (): void => {
		if (!isDisabled) {
			setShowUserMarker(!showUserMarker);
		}
	};

	const getTooltipText = (): string => {
		if (!userLocation) return t('noData');
		if (permissionStatus !== 'granted') return t('permissionRequired');
		if (!withinMapBoundary) return t('outsideCroatia');
		return showUserMarker ? t('hideMarker') : t('showMarker');
	};

	const variant = isDisabled ? 'controlRound' : 'controlRoundActive';

	return (
		<Tooltip content={getTooltipText()} position="left">
			<Button
				aria-label={showUserMarker ? t('hideMarker') : t('showMarker')}
				className="group"
				disabled={isDisabled}
				ref={containerRef}
				variant={variant}
				onClick={handleClick}
			>
				{showUserMarker ? (
					<MdPersonPinCircle className="h-6 w-6" />
				) : (
					<div className="relative inline-flex items-center justify-center">
						<MdPersonPinCircle className="h-6 w-6" />
						<div className="group-hover:bg-cldt-green group-focus-visible:bg-cldt-green absolute h-[2px] w-7 rotate-45 rounded-full bg-current" />
					</div>
				)}
			</Button>
		</Tooltip>
	);
}
