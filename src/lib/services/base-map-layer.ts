/**
 * Builds the Leaflet base layer for a map style, plain or clipped to Croatia.
 * Client-only (BaseMapLayer loads without SSR), so Leaflet is imported directly.
 */
import L from 'leaflet';
import type * as GeoJSON from 'geojson';
import { loadCroatiaBoundary } from '@/lib/croatia-boundary';
import { isBaseTilePane } from '@/lib/leaflet-panes';
import type { BaseMapConfig, BaseMapProvider } from './base-map-provider';
import { corsBoundaryCanvas, corsTileLayer, type BoundaryCanvasConstructor } from './cors-tile-layer';
import { DEFAULT_MAP_SERVICES } from './map-service-config';

/** Tile layer options for a style, shared by the plain and the clipped layer.
 *  Standard 256 px tiles on every screen, no `detectRetina`: what is shown then
 *  matches the zoom levels the offline download stores (HiDPI requests one level
 *  deeper would miss them offline), at a quarter of the tile requests. */
function tileOptions(config: BaseMapConfig): L.TileLayerOptions {
	const { attribution, maxZoom, minZoom, subdomains, bounds, noWrap, cors } = config;
	return {
		attribution,
		maxZoom,
		minZoom,
		// Only when set: Leaflet computes a subdomain for every tile, so an
		// explicit `undefined` would override its default and throw.
		...(subdomains !== undefined && { subdomains }),
		bounds,
		noWrap,
		...(cors && { crossOrigin: true }),
	};
}

function buildLayer(config: BaseMapConfig): L.TileLayer {
	const { url, attribution, maxZoom, minZoom, wms, cors } = config;
	if (wms) return L.tileLayer.wms(url, { ...wms, attribution, maxZoom, minZoom });
	const options = tileOptions(config);
	return cors ? corsTileLayer(url, options) : L.tileLayer(url, options);
}

/** The layer for `provider`. An unknown style, or one whose layer cannot be
 *  built, gets the first entry (OpenStreetMap) rather than an empty map. */
export function createBaseMapLayer(provider: BaseMapProvider): L.TileLayer {
	const fallback = DEFAULT_MAP_SERVICES[0];
	const config = DEFAULT_MAP_SERVICES.find((service) => service.name === provider) ?? fallback;
	try {
		return buildLayer(config);
	} catch (error) {
		console.error(`Error creating the ${provider} base layer:`, error);
		return buildLayer(fallback);
	}
}

/** The style's config when tile clipping applies to it. BoundaryCanvas clips
 *  z/x/y tiles, not WMS services such as Croatia Topo, which keep their plain layer. */
function clippableService(provider: BaseMapProvider): BaseMapConfig | null {
	const service = DEFAULT_MAP_SERVICES.find((s) => s.name === provider);
	return service && !service.wms ? service : null;
}

export function canClipBaseMap(provider: BaseMapProvider): boolean {
	return clippableService(provider) !== null;
}

/** The BoundaryCanvas plugin and the Croatia outline the clipped layer needs.
 *  The outline loader and the bundler each keep a loaded result and retry a
 *  failed one on the next call. */
export function loadBaseMapClip(): Promise<GeoJSON.FeatureCollection> {
	return Promise.all([import('leaflet-boundary-canvas'), loadCroatiaBoundary()]).then(([, boundary]) => boundary);
}

/**
 * A copy of the style's layer clipped to Croatia, once loadBaseMapClip has
 * resolved. Built from the provider's own config (URL including any key,
 * attribution, zoom range, subdomains), not scraped from a rendered tile: the
 * scraped `.png` pattern missed Esri's `{z}/{y}/{x}` URLs (one tile repeated
 * everywhere) and dropped query-string keys. Null for styles it cannot clip.
 */
export function createClippedBaseMapLayer(
	provider: BaseMapProvider,
	boundary: GeoJSON.FeatureCollection,
): L.TileLayer | null {
	const service = clippableService(provider);
	// Added to L by the plugin, which reads the global L itself.
	const BoundaryCanvas = (L.TileLayer as unknown as { BoundaryCanvas?: BoundaryCanvasConstructor }).BoundaryCanvas;
	if (!service || !BoundaryCanvas) return null;
	const ClippedLayer = corsBoundaryCanvas(BoundaryCanvas);
	return new ClippedLayer(service.url, { ...tileOptions(service), boundary });
}

/** Puts `layer` in place of the base tile layers. Overlay tile layers in their
 *  own panes (radar, Waymarked Trails) stay. */
export function replaceBaseLayer(map: L.Map, layer: L.TileLayer): void {
	map.eachLayer((existing) => {
		if (existing !== layer && existing instanceof L.TileLayer && isBaseTilePane(existing.options.pane)) {
			map.removeLayer(existing);
		}
	});
	layer.addTo(map);
}
