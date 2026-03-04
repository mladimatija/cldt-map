/**
 * Map tile layer service: provides base map configs (OSM, Topo, Satellite, etc.) and applies the active layer to a Leaflet map.
 * Used by BaseMapSelector and the map component; Leaflet is loaded only on the client for SSR.
 */
import { MapError } from '@/lib/utils';
import { type BaseMapConfig, BaseMapProvider } from './base-map-provider';
import { DEFAULT_MAP_SERVICES } from './map-service-config';

export { BaseMapProvider, type BaseMapConfig };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Leaflet types vary by environment
let L: any;

if (typeof window !== 'undefined') {
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- conditional load for SSR
	L = require('leaflet');
}

/**
 * Service for handling map operations
 */
export class MapService {
	private static instance: MapService;
	private map: L.Map | null = null;
	private services: BaseMapConfig[] = [];

	/**
	 * Get the singleton instance of the MapService
	 */
	public static getInstance(): MapService {
		if (!MapService.instance) {
			MapService.instance = new MapService();
		}
		return MapService.instance;
	}

	private constructor() {
		this.initializeDefaultServices();
	}

	/**
	 * Set the map instance to work with
	 */
	public setMap(map: L.Map): void {
		this.map = map;
	}

	/**
	 * Get the map instance
	 * @throws {MapError} if a map is not initialized
	 */
	public getMap(): L.Map {
		if (!this.map) {
			throw new MapError('ERR_MAP_NOT_INITIALIZED', 'Map is not initialized');
		}
		return this.map;
	}

	/**
	 * Check if the map has been initialized
	 */
	public isMapInitialized(): boolean {
		return this.map !== null;
	}

	/** @private */
	private initializeDefaultServices(): void {
		this.services = [...DEFAULT_MAP_SERVICES];
	}

	/**
	 * Get all available map services
	 * @param options - Options for filtering services
	 * @param options.names - Optional array of service names to filter by
	 * @returns Array of map service configurations
	 */
	public getServices({ names = [] }: { names?: string[] } = {}): BaseMapConfig[] {
		if (names.length === 0) {
			return [...this.services];
		}

		return this.services.filter((service) => names.includes(service.name));
	}

	/**
	 * Get configuration for a specific map service by name
	 * @param name - Name of the service to retrieve
	 * @param additionalServices - Optional additional services to include in the search
	 * @returns The service configuration or undefined if not found
	 */
	public getService(name: string, additionalServices: BaseMapConfig[] = []): BaseMapConfig | undefined {
		const allServices = [...this.services, ...additionalServices];
		return allServices.find((service) => service.name === name);
	}

	/**
	 * Get the default map service
	 * @returns Default map service configuration
	 */
	public getDefaultService(): BaseMapConfig {
		return this.services[0];
	}

	/**
	 * Get names of all available services
	 * @returns Array of service names
	 */
	public getServiceNames(): string[] {
		return this.services.map((service) => service.name);
	}

	/**
	 * Add a new map service
	 * @param config - Configuration for the new service
	 * @throws {MapError} if configuration is invalid
	 */
	public addService(config: BaseMapConfig): void {
		if (!this.validateServiceConfig(config)) {
			throw new MapError('ERR_INVALID_CONFIG', 'Invalid map service configuration');
		}
		this.services.push(config);
	}

	/**
	 * Remove a map service by name
	 * @param name - Name of the service to remove
	 */
	public removeService(name: string): void {
		this.services = this.services.filter((service) => service.name !== name);
	}

	/**
	 * Update an existing map service
	 * @param name - Name of the service to update
	 * @param updates - Partial configuration to update
	 * @throws {MapError} if service not found or updated config is invalid
	 */
	public updateService(name: string, updates: Partial<BaseMapConfig>): void {
		const index = this.services.findIndex((service) => service.name === name);
		if (index === -1) {
			throw new MapError('ERR_SERVICE_NOT_FOUND', `Service "${name}" not found`);
		}

		const updatedService = {
			...this.services[index],
			...updates,
		};

		if (!this.validateServiceConfig(updatedService)) {
			throw new MapError('ERR_INVALID_CONFIG', 'Invalid map service configuration');
		}

		this.services[index] = updatedService;
	}

	/**
	 * Validate a map service configuration
	 * @param config - Configuration to validate
	 * @returns True if configuration is valid
	 * @private
	 */
	private validateServiceConfig(config: BaseMapConfig): boolean {
		if (!config.name || !config.url || !config.attribution) {
			return false;
		}

		// Validate URL template
		const urlTemplate = config.url;
		if (!urlTemplate.includes('{z}') || !urlTemplate.includes('{x}') || !urlTemplate.includes('{y}')) {
			return false;
		}

		// Validate zoom levels if provided
		if (config.maxZoom !== undefined && config.minZoom !== undefined) {
			if (config.maxZoom < config.minZoom || config.maxZoom < 0 || config.minZoom < 0) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Create a tile layer for a given service
	 * @param service - Name of the service or service configuration
	 * @returns A Leaflet TileLayer
	 */
	public createTileLayer(service: string | BaseMapConfig): L.TileLayer {
		let config: BaseMapConfig;

		if (typeof service === 'string') {
			const foundService = this.getService(service);
			if (!foundService) {
				throw new MapError('ERR_SERVICE_NOT_FOUND', `Service "${service}" not found`);
			}
			config = foundService;
		} else {
			config = service;
		}

		// Extract options from config
		const { url, attribution, maxZoom, minZoom, subdomains, bounds, noWrap } = config;

		// Create the tile layer (detectRetina: request higher-zoom tiles on HiDPI for sharper 256px sources like OSM)
		return L.tileLayer(url, {
			attribution,
			maxZoom,
			minZoom,
			subdomains,
			bounds,
			noWrap,
			detectRetina: true,
		});
	}

	/**
	 * Create a base map layer for the specified provider
	 * @param provider - The map provider to use
	 * @returns A Leaflet TileLayer
	 */
	public createBaseMapLayer(provider: BaseMapProvider): L.TileLayer {
		try {
			// Ensure the provider is valid
			if (!Object.values(BaseMapProvider).includes(provider)) {
				console.error(`Invalid provider: ${provider}`);
				// Fall back to the default provider
				return this.createTileLayer(BaseMapProvider.OPEN_STREET_MAP);
			}

			// Special handling for problematic providers
			if (provider === BaseMapProvider.SATELLITE) {
				// Create a direct TileLayer instead of using the service config
				return L.tileLayer(
					'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
					{
						attribution:
							'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
						maxZoom: 18,
						minZoom: 0,
					},
				);
			}

			if (provider === BaseMapProvider.TERRAIN) {
				// Create a direct TileLayer for terrain
				return L.tileLayer(
					'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
					{
						attribution: 'Tiles &copy; Esri &mdash; Source: USGS, Esri, TANA, DeLorme, and NPS',
						maxZoom: 16,
						minZoom: 0,
					},
				);
			}

			if (provider === BaseMapProvider.CROATIA_TOPO) {
				// Create a WMS layer for Croatian topographic maps
				return L.tileLayer.wms('https://geoportal.dgu.hr/services/tk/wms', {
					layers: 'TK25', // TK25 is the topographic map 1:25000
					format: 'image/png',
					transparent: true,
					version: '1.3.0',
					attribution: '&copy; <a href="https://dgu.gov.hr/">Državna geodetska uprava</a>',
					maxZoom: 19,
					minZoom: 8,
				}) as unknown as L.TileLayer;
			}

			// Find the service configuration for this provider
			const service = this.getService(provider);

			if (!service) {
				console.error(`Service configuration not found for provider: ${provider}`);
				// Fall back to the default provider
				return this.createTileLayer(BaseMapProvider.OPEN_STREET_MAP);
			}

			return this.createTileLayer(service);
		} catch (error) {
			console.error('Error creating base map layer:', error);
			// Fall back to the default provider
			try {
				return this.createTileLayer(BaseMapProvider.OPEN_STREET_MAP);
			} catch (fallbackError) {
				console.error('Error creating fallback layer:', fallbackError);
				// Create a basic OSM layer as a last resort
				return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
					attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
					maxZoom: 19,
					detectRetina: true,
				});
			}
		}
	}

	/**
	 * Find the nearest point on a polyline to a given point
	 * @param point - The reference point
	 * @param polyline - Array of points forming the polyline
	 * @returns Object containing the nearest point, distance, and segment index
	 */
	public findNearestPointOnPolyline(
		point: L.LatLng,
		polyline: L.LatLng[],
	): { point: L.LatLng; distance: number; index: number } {
		if (polyline.length === 0) {
			throw new MapError('ERR_EMPTY_POLYLINE', 'Cannot find nearest point on empty polyline');
		}

		let minDistance = Infinity;
		let nearestPoint = polyline[0];
		let nearestIndex = 0;

		// Check each segment of the polyline
		for (let i = 0; i < polyline.length - 1; i++) {
			const p1 = polyline[i];
			const p2 = polyline[i + 1];

			const segmentPoint = this.closestPointOnSegment(point, p1, p2);
			const distance = point.distanceTo(segmentPoint);

			if (distance < minDistance) {
				minDistance = distance;
				nearestPoint = segmentPoint;
				nearestIndex = i;
			}
		}

		return {
			point: nearestPoint,
			distance: minDistance,
			index: nearestIndex,
		};
	}

	/**
	 * Calculate the closest point on a line segment to a given point
	 * @param p - The reference point
	 * @param p1 - First point of the segment
	 * @param p2 - Second point of the segment
	 * @returns The closest point on the segment
	 * @private
	 */
	private closestPointOnSegment(p: L.LatLng, p1: L.LatLng, p2: L.LatLng): L.LatLng {
		const x = p.lng;
		const y = p.lat;
		const x1 = p1.lng;
		const y1 = p1.lat;
		const x2 = p2.lng;
		const y2 = p2.lat;

		const A = x - x1;
		const B = y - y1;
		const C = x2 - x1;
		const D = y2 - y1;

		const dot = A * C + B * D;
		const lenSq = C * C + D * D;
		let param = -1;

		if (lenSq !== 0) {
			param = dot / lenSq;
		}

		let xx, yy;

		if (param < 0) {
			xx = x1;
			yy = y1;
		} else if (param > 1) {
			xx = x2;
			yy = y2;
		} else {
			xx = x1 + param * C;
			yy = y1 + param * D;
		}

		return L.latLng(yy, xx);
	}
}
