'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { useBlockMapPropagation } from '@/hooks';
import { cn, isWithinMapBoundary } from '@/lib/utils';
import { Tooltip } from '@/components/ui/Tooltip';
import { useMap } from 'react-leaflet';
import { MdMyLocation, MdLocationSearching } from 'react-icons/md';
import { useTranslations } from 'next-intl';
import { CONTROL_BTN_BASE, CONTROL_BTN_ACTIVE, CONTROL_BTN_INACTIVE } from './map-controls-constants';

type ButtonState = 'default' | 'locating' | 'disabled' | 'active';

interface LocationButtonProps {
	checkPermission?: (prompt: boolean) => Promise<void>;
}

export default function MapControlsLocationButton({ checkPermission }: LocationButtonProps): React.ReactElement {
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
	const buttonClasses = cn(
		CONTROL_BTN_BASE,
		buttonState === 'default' && CONTROL_BTN_INACTIVE,
		buttonState === 'active' && CONTROL_BTN_ACTIVE,
		buttonState === 'locating' &&
			'cursor-wait border border-gray-200 bg-cldt-blue/10 dark:border-[var(--border-color)] dark:bg-cldt-blue/20 dark:text-[var(--text-primary)]',
		buttonState === 'disabled' && cn(CONTROL_BTN_INACTIVE, 'cursor-not-allowed opacity-50'),
		buttonState !== 'disabled' && buttonState !== 'locating' && 'cursor-pointer',
	);

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
							<div className="absolute top-[15%] left-[15%] h-[70%] w-[70%] rounded-full bg-white dark:bg-(--bg-secondary)"></div>
						</div>
					</div>
				) : null}

				{buttonState === 'active' ? (
					<MdMyLocation
						className={`dark:hover:text-cldt-green h-6 w-6 dark:text-white ${isLocating || isAnimating ? 'opacity-0' : ''}`}
					/>
				) : (
					<MdLocationSearching
						className={`dark:hover:text-cldt-green h-6 w-6 dark:text-white ${isLocating || isAnimating ? 'opacity-0' : ''}`}
					/>
				)}
			</button>
		</Tooltip>
	);
}
