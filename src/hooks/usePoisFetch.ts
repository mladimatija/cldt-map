'use client';

import { useCallback, useMemo } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { loadPois, resetPoisCache } from '@/lib/pois';
import { useDatasetFetch } from './useDatasetFetch';

/** POI types the stage planner and trip brief safety stats depend on (water
 *  dry-stretch + town/settlement resupply cadence). These are always loaded so
 *  those stats stay complete regardless of which marker layers the user hides;
 *  markers still filter by enabledPoiTypes, so loaded-but-disabled types are not
 *  drawn. Mirrors the up-next strip loading UP_NEXT_TYPES independently. */
const STAT_REQUIRED_POI_TYPES = ['town', 'settlement', 'water'] as const;

/**
 * Loads the POIs of the enabled types into the map store and revalidates them
 * on tab focus (useDatasetFetch), so a freshly merged enrichment PR is picked up
 * without a full reload; per-file ETags keep that cheap.
 *
 * Enabling another type fetches just that file (loaded types are served from
 * the module cache). The default set is ~3 MB of JSON, so the first load runs
 * at browser idle time, off the startup path where it would compete with the
 * GPX parse and the first tiles; everything downstream (markers, planner water
 * stats, up-next strip) fills in a moment later.
 */
export function usePoisFetch(): void {
	const setPoisFile = useMapStore((s: MapStoreState) => s.setPoisFile);
	const enabledPoiTypes = useMapStore((s: MapStoreState) => s.enabledPoiTypes);

	// Stable key so toggling Set identity without membership change does not refire.
	const enabledKey = useMemo(() => [...enabledPoiTypes].sort().join(','), [enabledPoiTypes]);
	const load = useCallback(() => {
		const types = new Set(enabledKey.split(',').filter((t) => t.length > 0));
		for (const t of STAT_REQUIRED_POI_TYPES) types.add(t);
		return loadPois(types);
	}, [enabledKey]);

	useDatasetFetch({ load, reset: resetPoisCache, onData: setPoisFile, deferUntilIdle: true });
}
