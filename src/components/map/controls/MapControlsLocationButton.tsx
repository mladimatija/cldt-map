'use client';

import React, { useRef } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { useBlockMapPropagation } from '@/hooks';
import { isInCroatiaBbox } from '@/lib/geo-bounds';
import { Tooltip } from '@/components/ui/Tooltip';
import { useMap } from 'react-leaflet';
import { MdMyLocation, MdLocationSearching } from 'react-icons/md';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';

type ButtonState = 'default' | 'locating' | 'disabled' | 'active';

interface LocationButtonProps {
	checkPermission?: (prompt: boolean) => Promise<void>;
}

export default function MapControlsLocationButton({ checkPermission }: LocationButtonProps): React.ReactElement {
	const t = useTranslations('location');
	const containerRef = useRef<HTMLButtonElement>(null);
	useBlockMapPropagation(containerRef);
	const userLocation = useMapStore((state: MapStoreState) => state.userLocation);
	const isLocating = useMapStore((state: MapStoreState) => state.isLocating);
	const permissionStatus = useMapStore((state: MapStoreState) => state.permissionStatus);
	const getCurrentLocation = useMapStore((state: MapStoreState) => state.getCurrentLocation);
	const requestLocationPermission = useMapStore((state: MapStoreState) => state.requestLocationPermission);

	const map = useMap();

	const withinMapBoundary = userLocation ? isInCroatiaBbox(userLocation.lat, userLocation.lng) : true;

	// The spinner shows at once and stays 500 ms after locating ends, so a fast
	// fix does not flash it; the delay lives in the CSS transitions below.
	const spinnerClass = isLocating ? 'visible opacity-100' : 'invisible opacity-0 delay-500';
	const iconClass = isLocating ? 'opacity-0' : 'delay-500';

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
			const before = useMapStore.getState().userLocation;
			if (permissionStatus === 'granted') {
				await getCurrentLocation();
			} else {
				await requestLocationPermission();
			}
			// Fly after a first grant too (fixes never move the map on their own),
			// but only to a new fix: a denied or timed-out request leaves the old one.
			const location = useMapStore.getState().userLocation;
			if (location && location !== before && isInCroatiaBbox(location.lat, location.lng)) {
				map.flyTo([location.lat, location.lng], 14, {
					animate: true,
					duration: 1.5,
					easeLinearity: 0.25,
				});
			}
		} catch (error) {
			console.error('Error handling location button click:', error);
		}
	};

	const buttonState = getButtonState();
	const variant =
		buttonState === 'active'
			? 'controlRoundActive'
			: buttonState === 'locating'
				? 'controlRoundLocating'
				: 'controlRound';

	return (
		<Tooltip content={getTooltipText()} position="left">
			<Button
				aria-label={t('getMyLocation')}
				disabled={(buttonState === 'disabled' && permissionStatus !== 'prompt') || isLocating}
				ref={containerRef}
				variant={variant}
				onClick={handleClick}
			>
				<div
					className={`absolute inset-0 flex items-center justify-center transition-[opacity,visibility] duration-0 ${spinnerClass}`}
				>
					<div className="relative h-6 w-6">
						<div className="border-t-cldt-blue border-r-cldt-blue/70 border-b-cldt-blue border-l-cldt-blue/70 absolute top-0 left-0 h-full w-full animate-spin rounded-full border-2 motion-reduce:animate-none"></div>
						<div className="absolute top-[15%] left-[15%] h-[70%] w-[70%] rounded-full bg-white dark:bg-[var(--bg-secondary)]"></div>
					</div>
				</div>

				{buttonState === 'active' ? (
					<MdMyLocation
						className={`dark:hover:text-cldt-green h-6 w-6 transition-opacity duration-0 dark:text-white ${iconClass}`}
					/>
				) : (
					<MdLocationSearching
						className={`dark:hover:text-cldt-green h-6 w-6 transition-opacity duration-0 dark:text-white ${iconClass}`}
					/>
				)}
			</Button>
		</Tooltip>
	);
}
