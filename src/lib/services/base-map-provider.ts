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
	CROATIA_TOPO = 'CroatiaTopo',
	/** Dark / low-light base layer (CartoDB Dark Matter) for night use. */
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
