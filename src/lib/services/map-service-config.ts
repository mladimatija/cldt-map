import { BaseMapProvider, type BaseMapConfig } from './base-map-provider';

/** Default base map layer configurations used by MapService. */
export const DEFAULT_MAP_SERVICES: BaseMapConfig[] = [
	{
		name: BaseMapProvider.OPEN_STREET_MAP,
		url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
		attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
		maxZoom: 19,
		minZoom: 0,
		subdomains: 'abc',
	},
	{
		name: BaseMapProvider.OPEN_TOPO_MAP,
		url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
		attribution:
			'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="https://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
		maxZoom: 17,
		minZoom: 0,
		subdomains: 'abc',
	},
	{
		name: BaseMapProvider.SATELLITE,
		url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
		attribution:
			'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
		maxZoom: 18,
		minZoom: 0,
	},
	{
		name: BaseMapProvider.TERRAIN,
		url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
		attribution: 'Tiles &copy; Esri &mdash; Source: USGS, Esri, TANA, DeLorme, and NPS',
		maxZoom: 16,
		minZoom: 0,
	},
	{
		name: BaseMapProvider.CYCL_OSM,
		url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
		attribution:
			'&copy; <a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases" title="CyclOSM - Open Bicycle render">CyclOSM</a> | Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
		maxZoom: 18,
		minZoom: 0,
		subdomains: 'abc',
	},
	{
		name: BaseMapProvider.CROATIA_TOPO,
		url: 'https://geoportal.dgu.hr/wms',
		attribution: '&copy; <a href="https://dgu.gov.hr/">Državna geodetska uprava</a>',
		maxZoom: 19,
		minZoom: 0,
	},
];
