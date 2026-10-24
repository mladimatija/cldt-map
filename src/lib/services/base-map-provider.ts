import type { LatLngBoundsExpression } from 'leaflet';

/**
 * Available base map providers. Kept in a separate module, so config and map-service-config
 * can use it without creating a circular dependency with map-service.
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
}
