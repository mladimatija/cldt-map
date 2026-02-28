/**
 * Hook for MapService singleton: lists base map layers, current selection, and add/remove/update.
 * MapService is required() only on the client to avoid pulling Leaflet in during SSR.
 */
import { useState, useCallback, useMemo } from 'react';
import type { BaseMapConfig } from '@/lib/services/map-service';
import { MapError } from '@/lib/utils';

type MapServiceClass = typeof import('@/lib/services/map-service').MapService;
let MapService: MapServiceClass | undefined;

if (typeof window !== 'undefined') {
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- conditional load for SSR
	const mapServiceModule = require('@/lib/services/map-service');
	MapService = mapServiceModule.MapService;
}

interface MapServiceState {
	services: BaseMapConfig[];
	currentService: BaseMapConfig | null;
	isLoading: boolean;
	error: MapError | null;
}

interface MapServiceHook {
	/** All available services */
	services: BaseMapConfig[];
	/** Currently selected service */
	currentService: BaseMapConfig | null;
	/** Whether a service operation is in progress */
	isLoading: boolean;
	/** Any error that occurred */
	error: MapError | null;
	/** Initialize available services */
	initializeServices: () => void;
	/** Select a service by name */
	setCurrentService: (name: string) => void;
	/** Add a new service */
	addService: (config: BaseMapConfig) => void;
	/** Remove a service by name */
	removeService: (name: string) => void;
	/** Update an existing service */
	updateService: (name: string, config: Partial<BaseMapConfig>) => void;
	/** Get filtered services by names */
	getFilteredServices: (names?: string[]) => BaseMapConfig[];
	/** Get a specific service by name */
	getService: (name: string) => BaseMapConfig | undefined;
}

/**
 * Hook for working with map services
 *
 * This hook provides a convenient interface for managing map services and tile layers.
 * It allows filtering available services, adding custom services, and managing the current selection.
 *
 * @returns Object with services and management methods
 *
 * @example
 * ```tsx
 * // Get all services
 * const { services, currentService, setCurrentService } = useMapService();
 *
 * // Initialize on component mount
 * useEffect(() => {
 *   initializeServices();
 * }, [initializeServices]);
 *
 * // Get filtered services
 * const osmServices = getFilteredServices(['OpenStreetMap', 'OpenTopoMap']);
 *
 * // Switch to a different service
 * const handleServiceChange = (name) => {
 *   setCurrentService(name);
 * };
 * ```
 */
export function useMapService(): MapServiceHook {
	const [state, setState] = useState<MapServiceState>({
		services: [],
		currentService: null,
		isLoading: false,
		error: null,
	});

	// Safety check for SSR
	const isClient = typeof window !== 'undefined';

	// Get a map service instance, but only on the client side
	const mapService = useMemo(() => {
		if (!isClient || !MapService) {
			return null;
		}
		return MapService.getInstance();
	}, [isClient]);

	// Create error handler
	const handleError = useCallback((error: Error) => {
		console.error('Map service error:', error);
		setState((prev) => ({ ...prev, error: error instanceof MapError ? error : new MapError(error.message) }));
	}, []);

	// Initialize services
	const initializeServices = useCallback(() => {
		setState((prev) => ({ ...prev, isLoading: true, error: null }));

		try {
			if (!isClient || !mapService) {
				setState((prev) => ({ ...prev, isLoading: false }));
				return;
			}

			const services = mapService.getServices();
			const defaultService = mapService.getDefaultService();

			setState({
				services,
				currentService: defaultService,
				isLoading: false,
				error: null,
			});
		} catch (error) {
			handleError(error instanceof Error ? error : new Error(String(error)));
			setState((prev) => ({ ...prev, isLoading: false }));
		}
	}, [handleError, mapService, isClient]);

	// Set the current service
	const setCurrentService = useCallback(
		(name: string) => {
			if (!isClient || !mapService) {
				return;
			}

			try {
				const service = mapService.getService(name);

				if (service) {
					setState((prev) => ({
						...prev,
						currentService: service,
					}));
				}
			} catch (error) {
				handleError(error instanceof Error ? error : new Error(String(error)));
			}
		},
		[handleError, mapService, isClient],
	);

	// Run a mapService mutation and refresh state.services (shared by add/remove/update).
	const withServiceMutation = useCallback(
		(mutate: (svc: NonNullable<typeof mapService>) => void) => {
			if (!isClient || !mapService) return;
			try {
				mutate(mapService);
				const services = mapService.getServices();
				setState((prev) => ({ ...prev, services }));
			} catch (error) {
				handleError(error instanceof Error ? error : new Error(String(error)));
			}
		},
		[handleError, mapService, isClient],
	);

	// Add new service
	const addService = useCallback(
		(config: BaseMapConfig) => withServiceMutation((svc) => svc.addService(config)),
		[withServiceMutation],
	);

	// Remove service
	const removeService = useCallback(
		(name: string) => withServiceMutation((svc) => svc.removeService(name)),
		[withServiceMutation],
	);

	// Update service
	const updateService = useCallback(
		(name: string, config: Partial<BaseMapConfig>) => withServiceMutation((svc) => svc.updateService(name, config)),
		[withServiceMutation],
	);

	// Get filtered services
	const getFilteredServices = useCallback(
		(names?: string[]) => {
			if (!isClient || !mapService) {
				return [];
			}

			try {
				return mapService.getServices({ names });
			} catch (error) {
				handleError(error instanceof Error ? error : new Error(String(error)));
				return [];
			}
		},
		[handleError, mapService, isClient],
	);

	// Get service by name
	const getService = useCallback(
		(name: string) => {
			if (!isClient || !mapService) {
				return undefined;
			}

			try {
				return mapService.getService(name);
			} catch (error) {
				handleError(error instanceof Error ? error : new Error(String(error)));
				return undefined;
			}
		},
		[handleError, mapService, isClient],
	);

	return {
		services: state.services,
		currentService: state.currentService,
		isLoading: state.isLoading,
		error: state.error,
		initializeServices,
		setCurrentService,
		addService,
		removeService,
		updateService,
		getFilteredServices,
		getService,
	};
}
