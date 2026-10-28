/**
 * Builds the Leaflet base layer for a map style. Client-only (BaseMapSelector
 * loads without SSR), so Leaflet is imported directly.
 */
import L from 'leaflet';
import type { BaseMapConfig, BaseMapProvider } from './base-map-provider';
import { DEFAULT_MAP_SERVICES } from './map-service-config';

function buildLayer(config: BaseMapConfig): L.TileLayer {
	const { url, attribution, maxZoom, minZoom, subdomains, bounds, noWrap, detectRetina = true, wms } = config;
	if (wms) return L.tileLayer.wms(url, { ...wms, attribution, maxZoom, minZoom });
	return L.tileLayer(url, {
		attribution,
		maxZoom,
		minZoom,
		// Only when set: Leaflet computes a subdomain for every tile, so an
		// explicit `undefined` would override its default and throw.
		...(subdomains !== undefined && { subdomains }),
		bounds,
		noWrap,
		detectRetina,
	});
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
