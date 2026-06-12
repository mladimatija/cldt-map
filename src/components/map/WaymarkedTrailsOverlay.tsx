'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { useMapStore, type MapStoreState } from '@/lib/store';

const TILE_URL = 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png';
const ATTRIBUTION =
	'&copy; <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/de/">CC-BY-SA</a>)';

/**
 * Waymarked Trails hiking overlay: renders OSM hiking route relations (the
 * CLDT's own relation plus every connecting marked trail) as a transparent
 * tile layer over the active base map. Lives in Leaflet's default overlay
 * pane, so it sits above base tiles and below the trail polyline and
 * markers. Not part of the offline pre-cache - like the radar overlay, it
 * is an online-only enrichment.
 */
export function WaymarkedTrailsOverlay(): null {
	const map = useMap();
	const enabled = useMapStore((s: MapStoreState) => s.waymarkedTrailsOverlay);
	const layerRef = useRef<L.TileLayer | null>(null);

	useEffect(() => {
		// Dedicated pane: its name exempts the layer from the base-map
		// switcher's teardown, and DOM-order insertion BEFORE the vector
		// overlay pane keeps the tiles under the trail polyline and markers.
		// (The app's CSS flattens every pane's z-index with !important, so
		// stacking inside the map is purely document order - same pattern as
		// the completion overlay pane.)
		if (!map.getPane('waymarkedPane')) {
			map.createPane('waymarkedPane');
			const pane = map.getPane('waymarkedPane');
			const overlayPane = map.getPane('overlayPane');
			if (pane && overlayPane?.parentNode) {
				overlayPane.parentNode.insertBefore(pane, overlayPane);
			}
		}
		if (enabled && !layerRef.current) {
			layerRef.current = L.tileLayer(TILE_URL, {
				attribution: ATTRIBUTION,
				maxZoom: 18,
				opacity: 0.9,
				pane: 'waymarkedPane',
			});
			layerRef.current.addTo(map);
		} else if (!enabled && layerRef.current) {
			layerRef.current.remove();
			layerRef.current = null;
		}
		return () => {
			layerRef.current?.remove();
			layerRef.current = null;
		};
	}, [enabled, map]);

	return null;
}
