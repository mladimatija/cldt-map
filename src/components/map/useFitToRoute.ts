'use client';

import { useEffect, type RefObject } from 'react';
import type L from 'leaflet';
import { FIT_ROUTE_EVENT } from '@/components/map/controls/ZoomControls';

/** Subscribes to FIT_ROUTE_EVENT and fits the map to the route bounds when fired. */
export function useFitToRoute(map: L.Map | null, routeLayerRef: RefObject<L.Polyline | null>): void {
	useEffect(() => {
		if (!map) return;

		const handleFitToRoute = (): void => {
			if (routeLayerRef.current) {
				map.fitBounds(routeLayerRef.current.getBounds(), { padding: [50, 50] });
			}
		};

		window.addEventListener(FIT_ROUTE_EVENT, handleFitToRoute);
		return () => window.removeEventListener(FIT_ROUTE_EVENT, handleFitToRoute);
	}, [map, routeLayerRef]);
}
