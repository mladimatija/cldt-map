'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Marker, Tooltip, useMap } from 'react-leaflet';
import { useTranslations } from 'next-intl';
import L from 'leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { isWithinMapBoundary, getNavigateToPointUrl } from '@/lib/utils';

/** Distance threshold (m) beyond which a user is considered "off trail".
 *  15m allows for typical GPS inaccuracy when the user is actually on the trail. */
const OFF_TRAIL_DISTANCE_M = 15;

const NAVIGATE_BTN_CLASS = 'user-location-navigate-btn';
const CLOSE_BTN_CLASS = 'user-location-close-btn';

/**
 * User location marker and optional "off trail" tooltip with navigate-to-trail link. Hides marker when outside Croatia or permission denied.
 */
export default function MapMarkers(): React.ReactElement | null {
	const t = useTranslations('mapMarkers');
	const map = useMap();
	const userMarkerRef = useRef<L.Marker | null>(null);
	const [markerReady, setMarkerReady] = useState(false);
	const [isOffTrailTooltipOpen, setIsOffTrailTooltipOpen] = useState(true);

	// User location state from store
	const userLocation = useMapStore((state: MapStoreState) => state.userLocation);
	const isLocating = useMapStore((state: MapStoreState) => state.isLocating);
	const showUserMarker = useMapStore((state: MapStoreState) => state.showUserMarker);
	const permissionStatus = useMapStore((state: MapStoreState) => state.permissionStatus);
	const closestPoint = useStore((state: StoreState) => state.closestPoint);
	const gpxLoaded = useStore((state: StoreState) => state.gpxLoaded);
	const withinMapBoundary = userLocation ? isWithinMapBoundary(userLocation.lat, userLocation.lng) : true;
	const shouldShowLocation = userLocation && showUserMarker && permissionStatus === 'granted' && withinMapBoundary;

	const isOffTrail =
		!gpxLoaded ||
		!userLocation ||
		permissionStatus !== 'granted' ||
		!withinMapBoundary ||
		(closestPoint !== null && closestPoint.distance > OFF_TRAIL_DISTANCE_M);

	/** True, when we can actually navigate: trail loaded, the closest point known, and user is far from trail. */
	const canNavigateToTrail =
		gpxLoaded && userLocation && closestPoint !== null && closestPoint.distance > OFF_TRAIL_DISTANCE_M;

	// Reset tooltip visibility when user becomes off trail (show by default)
	useEffect(() => {
		if (isOffTrail) {
			queueMicrotask(() => setIsOffTrailTooltipOpen(true));
		}
	}, [isOffTrail]);

	const handleMarkerClick = useCallback((): void => {
		if (isOffTrail) {
			setIsOffTrailTooltipOpen(true);
		}
	}, [isOffTrail]);

	const setMarkerRef = useCallback((marker: L.Marker | null): void => {
		userMarkerRef.current = marker;
		setMarkerReady(!!marker);
	}, []);

	// Create user icon - define it outside the effect so we can use it in the render
	const userIcon = L.divIcon({
		className: 'user-location-marker',
		html: '<div class="user-location-dot"></div>',
		iconSize: [20, 20],
		iconAnchor: [10, 10],
	});

	// Update marker when the user location changes
	useEffect(() => {
		if (!userLocation || !withinMapBoundary || permissionStatus !== 'granted') {
			return;
		}
		if (isLocating) {
			map.setView([userLocation.lat, userLocation.lng], 14);
		}
	}, [userLocation, isLocating, map, withinMapBoundary, permissionStatus]);

	// Imperative permanent tooltip when off trail - bind to marker to avoid _source null error
	useEffect(() => {
		const marker = userMarkerRef.current;
		if (!shouldShowLocation || !isOffTrail || !userLocation || !isOffTrailTooltipOpen || !marker || !markerReady) {
			if (marker) {
				const existing = marker.getTooltip();
				if (existing) {
					marker.closeTooltip();
					marker.unbindTooltip();
				}
			}
			return;
		}

		const tooltipContent = `
      <div class="user-location-tooltip-inner">
        <button aria-label="${t('close')}" class="${CLOSE_BTN_CLASS}" type="button">×</button>
        <div class="font-medium">${t('yourLocation')}</div>
        ${canNavigateToTrail ? `<button class="${NAVIGATE_BTN_CLASS} mt-1 text-sm text-cldt-blue hover:text-cldt-green hover:underline cursor-pointer block w-full outline-none" type="button">${t('navigateToTrail')}</button>` : ''}
      </div>
    `;

		marker.bindTooltip(tooltipContent, {
			offset: L.point(0, -15),
			direction: 'top',
			permanent: true,
			className: 'map-tooltip map-tooltip--narrow',
		});
		marker.openTooltip();
		const tooltip = marker.getTooltip();
		const el = tooltip?.getElement();
		if (el) {
			L.DomEvent.disableClickPropagation(el);
			L.DomEvent.disableScrollPropagation(el);
			const handleClick = (e: MouseEvent): void => {
				const target = e.target as HTMLElement;
				const closeBtn = target.closest(`.${CLOSE_BTN_CLASS}`);
				const navBtn = target.closest(`.${NAVIGATE_BTN_CLASS}`);
				if (closeBtn) {
					e.preventDefault();
					e.stopPropagation();
					setIsOffTrailTooltipOpen(false);
					return;
				}
				if (navBtn) {
					e.preventDefault();
					e.stopPropagation();
					const loc = useMapStore.getState().userLocation;
					const forceCalc = useStore.getState().forceCalculateClosestPointFromLocation;
					if (loc && forceCalc) {
						forceCalc(loc);
						const cp = useStore.getState().closestPoint;
						if (cp) {
							const url = getNavigateToPointUrl(loc.lat, loc.lng, cp.point.lat, cp.point.lng);
							window.open(url, '_blank', 'noopener,noreferrer');
						}
						setIsOffTrailTooltipOpen(false);
					}
				}
			};
			el.addEventListener('click', handleClick);
			return () => {
				el.removeEventListener('click', handleClick);
				marker.closeTooltip();
				marker.unbindTooltip();
			};
		}

		return () => {
			marker.closeTooltip();
			marker.unbindTooltip();
		};
	}, [map, markerReady, shouldShowLocation, isOffTrail, canNavigateToTrail, isOffTrailTooltipOpen, userLocation, t]);

	if (!shouldShowLocation) {
		return null;
	}

	return (
		<Marker
			eventHandlers={{
				click: handleMarkerClick,
			}}
			icon={userIcon}
			position={[userLocation.lat, userLocation.lng]}
			ref={setMarkerRef}
		>
			{!isOffTrail && (
				<Tooltip className="leaflet-tooltip-styled" direction="top" offset={[0, -15]} permanent={false}>
					<div className="text-center font-medium">{t('yourLocation')}</div>
				</Tooltip>
			)}
		</Marker>
	);
}
