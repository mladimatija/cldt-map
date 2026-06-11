'use client';

/**
 * Walking pace with the optional pack-weight penalty applied. The single
 * source of effective pace for every ETA surface (HUD, planner, ruler,
 * sunset projection, trip brief) so they can never disagree. Identity with
 * `walkingPaceKmh` while the feature is off (base weight unset or the
 * adjustment checkbox unticked), which is the default.
 */

import { useMapStore, type MapStoreState } from '@/lib/store';
import { effectivePaceKmh } from '@/lib/pack-weight';

export function usePackAdjustedPaceKmh(): number {
	const walkingPaceKmh = useMapStore((s: MapStoreState) => s.walkingPaceKmh);
	const packBaseWeightKg = useMapStore((s: MapStoreState) => s.packBaseWeightKg);
	const packEtaAdjust = useMapStore((s: MapStoreState) => s.packEtaAdjust);
	return effectivePaceKmh(walkingPaceKmh, packBaseWeightKg, packEtaAdjust);
}

/** Non-hook variant for event handlers and Leaflet callbacks that read the
 *  store via getState(). */
export function packAdjustedPaceKmhFromState(state: MapStoreState): number {
	return effectivePaceKmh(state.walkingPaceKmh, state.packBaseWeightKg, state.packEtaAdjust);
}
