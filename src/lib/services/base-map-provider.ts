import type { LatLngBoundsExpression, WMSOptions } from 'leaflet';

/**
 * Available base map providers. Kept apart from the Leaflet layer factory
 * (base-map-layer), so config and the store can use it without loading Leaflet.
 */
export enum BaseMapProvider {
	OPEN_STREET_MAP = 'OpenStreetMap',
	OPEN_TOPO_MAP = 'OpenTopoMap',
	SATELLITE = 'Satellite',
	TERRAIN = 'Terrain',
	CYCL_OSM = 'CyclOSM',
	/** OpenHikingMap (openmaps.fr) - OpenTopoMap-based style with hiking-specific additions. */
	OPEN_HIKING_MAP = 'OpenHikingMap',
	CROATIA_TOPO = 'CroatiaTopo',
	/** Dark / low-light base layer (CARTO Dark Matter) for night use. Needs NEXT_PUBLIC_CARTO_BASEMAPS_KEY. */
	DARK = 'Dark',
}

/** Base map layer configuration. */
export interface BaseMapConfig {
	name: string;
	url: string;
	attribution: string;
	maxZoom?: number;
	minZoom?: number;
	subdomains?: string;
	bounds?: LatLngBoundsExpression;
	noWrap?: boolean;
	/** Set for a WMS service: `url` is then the service endpoint, not a z/x/y
	 *  template, so the tile cache and the boundary clip leave the style alone. */
	wms?: Pick<WMSOptions, 'layers' | 'format' | 'transparent' | 'version'>;
}
