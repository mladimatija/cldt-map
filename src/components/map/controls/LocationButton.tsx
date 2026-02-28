'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { useBlockMapPropagation } from '@/hooks';
import { isWithinMapBoundary } from '@/lib/utils';
import { Tooltip } from '@/components/ui/Tooltip';
import classNames from 'classnames';
import { useMap } from 'react-leaflet';
import { MdMyLocation, MdLocationSearching } from 'react-icons/md';
import { useTranslations } from 'next-intl';

type ButtonState = 'default' | 'locating' | 'disabled' | 'active';

interface LocationButtonProps {
	checkPermission?: (prompt: boolean) => Promise<void>;
}

export default function LocationButton({ checkPermission }: LocationButtonProps): React.ReactElement {
	const t = useTranslations('location');
	const [isAnimating, setIsAnimating] = useState(false);
	const containerRef = useRef<HTMLButtonElement>(null);
	useBlockMapPropagation(containerRef);
	const userLocation = useMapStore((state: MapStoreState) => state.userLocation);
	const isLocating = useMapStore((state: MapStoreState) => state.isLocating);
	const permissionStatus = useMapStore((state: MapStoreState) => state.permissionStatus);
	const getCurrentLocation = useMapStore((state: MapStoreState) => state.getCurrentLocation);
	const requestLocationPermission = useMapStore((state: MapStoreState) => state.requestLocationPermission);

	const map = useMap();

	const withinMapBoundary = userLocation ? isWithinMapBoundary(userLocation.lat, userLocation.lng) : true;

	useEffect(() => {
		if (isLocating) {
			queueMicrotask(() => setIsAnimating(true));
		} else {
			const timer = setTimeout(() => {
				queueMicrotask(() => setIsAnimating(false));
			}, 500);

			return () => clearTimeout(timer);
		}
	}, [isLocating]);

	const isButtonDisabled = (): boolean => {
		if (isLocating) return true;
		if (permissionStatus === 'denied') return true;
		return !!(userLocation && !withinMapBoundary);
	};

	const getButtonState = (): ButtonState => {
		if (isLocating) {
			return 'locating';
		}
		if (permissionStatus === 'denied') {
			return 'disabled';
		}
		if (userLocation && !withinMapBoundary) {
			return 'disabled';
		}
		if (userLocation) {
			return 'active';
		}
		return 'default';
	};

	const getTooltipText = (): string => {
		if (permissionStatus === 'denied') return t('permissionDenied');
		if (userLocation && !withinMapBoundary) return t('outsideCroatia');
		if (isLocating) return t('gettingLocation');
		return userLocation ? t('refreshLocation') : t('showMyLocation');
	};

	const handleClick = async (): Promise<void> => {
		if (isButtonDisabled()) {
			if (permissionStatus === 'prompt') {
				await (checkPermission ?? requestLocationPermission)(true);
			}
			return;
		}

		try {
			if (permissionStatus === 'granted') {
				await getCurrentLocation();
				const location = useMapStore.getState().userLocation;
				if (location?.lat && location?.lng && isWithinMapBoundary(location.lat, location.lng)) {
					map.flyTo([location.lat, location.lng], 14, {
						animate: true,
						duration: 1.5,
						easeLinearity: 0.25,
					});
				}
			} else {
				await requestLocationPermission();
			}
		} catch (error) {
			console.error('Error handling location button click:', error);
		}
	};

	const buttonState = getButtonState();
	const buttonClasses = classNames(
		'w-10 h-10 rounded-full flex items-center justify-center border border-gray-200 shadow-md transition-all outline-none hover:border-2 focus-visible:border-2',
		{
			'bg-white hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green':
				buttonState === 'default',
			'bg-cldt-blue/10': buttonState === 'locating',
			'bg-gray-100 cursor-not-allowed': buttonState === 'disabled',
			'bg-white border-2 border-cldt-blue text-cldt-blue hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green':
				buttonState === 'active',
			'cursor-pointer': buttonState !== 'disabled',
		},
	);

	const iconColor =
		buttonState === 'locating'
			? 'text-cldt-blue'
			: buttonState === 'disabled'
				? 'text-gray-400'
				: buttonState === 'active'
					? ''
					: 'text-gray-700';

	return (
		<Tooltip content={getTooltipText()} position="left">
			<button
				aria-label={t('getMyLocation')}
				className={buttonClasses}
				disabled={(buttonState === 'disabled' && permissionStatus !== 'prompt') || isLocating}
				ref={containerRef}
				onClick={handleClick}
			>
				{isLocating || isAnimating ? (
					<div className="absolute inset-0 flex items-center justify-center">
						<div className="relative h-6 w-6">
							<div className="border-t-cldt-blue border-r-cldt-blue/70 border-b-cldt-blue border-l-cldt-blue/70 absolute top-0 left-0 h-full w-full animate-spin rounded-full border-2"></div>
							<div className="absolute top-[15%] left-[15%] h-[70%] w-[70%] rounded-full bg-white"></div>
						</div>
					</div>
				) : null}

				{buttonState === 'active' ? (
					<MdMyLocation className={`h-6 w-6 ${iconColor} ${isLocating || isAnimating ? 'opacity-0' : ''}`} />
				) : (
					<MdLocationSearching className={`h-6 w-6 ${iconColor} ${isLocating || isAnimating ? 'opacity-0' : ''}`} />
				)}
			</button>
		</Tooltip>
	);
}
