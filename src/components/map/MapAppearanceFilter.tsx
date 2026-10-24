'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { mapAppearanceFilter } from '@/lib/map-appearance';

/**
 * Applies the persisted "Map appearance" brightness / contrast / saturation to
 * the base tiles, whether or not the Tools panel is open. The filter goes on
 * the tile pane only: trail colours (grade, surface, SAC), markers and popups
 * keep their true colours, and a filter on the map container would also
 * re-anchor fixed-position panels rendered inside it.
 */
export function MapAppearanceFilter(): null {
	const map = useMap();
	const mapAppearance = useMapStore((s: MapStoreState) => s.mapAppearance);

	useEffect(() => {
		const tilePane = map.getPane('tilePane');
		if (!tilePane) return;
		tilePane.style.filter = mapAppearanceFilter(mapAppearance);
		return () => {
			tilePane.style.filter = '';
		};
	}, [map, mapAppearance]);

	return null;
}
