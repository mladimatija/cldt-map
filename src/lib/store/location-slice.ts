import type { StateCreator } from 'zustand';
import type { StoreState, LocationSlice } from './types';

/**
 * The data store's location slice. It holds only the user's location, kept in sync
 * by the map store (the authoritative location source - it owns the geolocation
 * service wiring, permission state, and the marker toggle). Trail-slice reads
 * userLocation here to compute the closest trail point, so setUserLocation also
 * clears the cached closest point to force a recompute.
 */
export const createLocationSlice: StateCreator<StoreState, [], [], LocationSlice> = (set) => ({
	userLocation: null,

	setUserLocation: (location) =>
		set({
			userLocation: location,
			closestPoint: null,
			closestPointCalculated: false,
			showClosestPointLine: false,
		}),
});
