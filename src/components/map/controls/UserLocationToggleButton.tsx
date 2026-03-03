'use client';

import React, { useRef } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { useBlockMapPropagation } from '@/hooks';
import { isWithinMapBoundary } from '@/lib/utils';
import { Tooltip } from '@/components/ui/Tooltip';
import classNames from 'classnames';
import { MdPersonPinCircle } from 'react-icons/md';
import { useTranslations } from 'next-intl';

export default function UserLocationToggleButton(): React.ReactElement {
	const t = useTranslations('location');
	const containerRef = useRef<HTMLButtonElement>(null);
	useBlockMapPropagation(containerRef);
	const showUserMarker = useMapStore((state: MapStoreState) => state.showUserMarker);
	const setShowUserMarker = useMapStore((state: MapStoreState) => state.setShowUserMarker);
	const permissionStatus = useMapStore((state: MapStoreState) => state.permissionStatus);
	const userLocation = useMapStore((state: MapStoreState) => state.userLocation);

	const withinMapBoundary = userLocation ? isWithinMapBoundary(userLocation.lat, userLocation.lng) : true;
	const isDisabled = !userLocation || permissionStatus !== 'granted' || !withinMapBoundary;

	const buttonClasses = classNames(
		'w-10 h-10 rounded-full flex items-center justify-center shadow-md transition-all outline-none',
		{
			'bg-white border-2 border-cldt-blue text-cldt-blue hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green':
				showUserMarker && !isDisabled,
			'bg-white hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green':
				!showUserMarker && !isDisabled,
			'bg-gray-100 cursor-not-allowed': isDisabled,
			'cursor-pointer': !isDisabled,
		},
	);

	const iconColor = isDisabled ? 'text-gray-400' : showUserMarker ? '' : 'text-cldt-blue';

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

	return (
		<Tooltip content={getTooltipText()} position="left">
			<button
				aria-label={showUserMarker ? t('hideMarker') : t('showMarker')}
				className={buttonClasses}
				disabled={isDisabled}
				ref={containerRef}
				onClick={handleClick}
			>
				{showUserMarker ? (
					<MdPersonPinCircle className={`h-6 w-6 ${iconColor}`} />
				) : (
					<div className="relative inline-flex items-center justify-center">
						<MdPersonPinCircle className={`h-6 w-6 ${iconColor}`} />
						<div className="absolute h-[2px] w-7 rotate-45 rounded-full bg-gray-700" />
					</div>
				)}
			</button>
		</Tooltip>
	);
}
