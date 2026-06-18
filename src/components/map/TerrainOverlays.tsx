'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { useMapStore, type MapStoreState } from '@/lib/store';

/** Esri World Hillshade - free, no API key, same ArcGIS family as the satellite
 *  base. Esri tiles use {z}/{y}/{x} order (y before x). */
const HILLSHADE_URL =
	'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}';
const HILLSHADE_ATTRIBUTION = 'Hillshade: &copy; <a href="https://www.esri.com">Esri</a>, USGS';

/** OpenTopoMap - free, no API key (already the "Topo" base provider). Carries
 *  contour lines on a light land background; multiply blend (set on the pane)
 *  drops that background out so only the lines/relief darken the base. */
const CONTOUR_URL = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
const CONTOUR_ATTRIBUTION =
	'Contours: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';

interface TerrainLayer {
	key: 'hillshade' | 'contour';
	pane: string;
	url: string;
	attribution: string;
	opacity: number;
	/** Native source max zoom; Leaflet upscales beyond it so the overlay stays
	 *  visible when zoomed past the source's deepest tiles. */
	maxNativeZoom: number;
	subdomains?: string;
}

// Opacities are tuned for legibility over satellite: the relief/contour lines
// read clearly without hiding the imagery underneath.
const TERRAIN_LAYERS: TerrainLayer[] = [
	{
		key: 'hillshade',
		pane: 'hillshadePane',
		url: HILLSHADE_URL,
		attribution: HILLSHADE_ATTRIBUTION,
		opacity: 0.6,
		maxNativeZoom: 16,
	},
	{
		key: 'contour',
		pane: 'contourPane',
		url: CONTOUR_URL,
		attribution: CONTOUR_ATTRIBUTION,
		opacity: 0.7,
		maxNativeZoom: 17,
		subdomains: 'abc',
	},
];

/** Map max zoom to upscale overlay tiles to (matches the app's deepest zoom). */
const OVERLAY_MAX_ZOOM = 19;

/**
 * Standalone terrain overlays: a hillshade relief layer (Esri) and a contour
 * lines layer (OpenTopoMap), each toggled independently and stackable over any
 * base map - including satellite. Both render in dedicated panes set to
 * `mix-blend-mode: multiply`, so they darken the base (and OpenTopoMap's light
 * land background drops out, leaving the contour lines) instead of painting an
 * opaque sheet over it. Like the Waymarked Trails and radar overlays, these are
 * online-only enrichments and are not part of the offline pre-cache.
 */
export function TerrainOverlays(): null {
	const map = useMap();
	const hillshade = useMapStore((s: MapStoreState) => s.hillshadeOverlayEnabled);
	const contour = useMapStore((s: MapStoreState) => s.contourOverlayEnabled);
	const layersRef = useRef<Record<TerrainLayer['key'], L.TileLayer | null>>({ hillshade: null, contour: null });

	useEffect(() => {
		const enabled: Record<TerrainLayer['key'], boolean> = { hillshade, contour };
		// Dedicated panes, created once and inserted just before the vector
		// overlay pane so the tiles sit above the base but below the trail and
		// markers (the app flattens pane z-index, so document order wins). The
		// multiply blend is what makes them read as overlays over satellite.
		for (const { pane } of TERRAIN_LAYERS) {
			if (!map.getPane(pane)) {
				map.createPane(pane);
				const el = map.getPane(pane);
				const overlayPane = map.getPane('overlayPane');
				if (el) {
					el.style.mixBlendMode = 'multiply';
					if (overlayPane?.parentNode) overlayPane.parentNode.insertBefore(el, overlayPane);
				}
			}
		}
		for (const layer of TERRAIN_LAYERS) {
			const existing = layersRef.current[layer.key];
			if (enabled[layer.key] && !existing) {
				layersRef.current[layer.key] = L.tileLayer(layer.url, {
					attribution: layer.attribution,
					maxNativeZoom: layer.maxNativeZoom,
					maxZoom: OVERLAY_MAX_ZOOM,
					opacity: layer.opacity,
					pane: layer.pane,
					...(layer.subdomains ? { subdomains: layer.subdomains } : {}),
				}).addTo(map);
			} else if (!enabled[layer.key] && existing) {
				existing.remove();
				layersRef.current[layer.key] = null;
			}
		}
	}, [map, hillshade, contour]);

	// Teardown lives in its own mount-only effect (not the reconcile effect's
	// return) so toggling one overlay never tears down the other. layersRef has a
	// stable identity, so this reads the live layers at unmount.
	useEffect(() => {
		const layers = layersRef.current;
		return () => {
			for (const { key } of TERRAIN_LAYERS) {
				layers[key]?.remove();
				layers[key] = null;
			}
		};
	}, []);

	return null;
}
