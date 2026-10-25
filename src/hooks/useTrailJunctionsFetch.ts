import { useMapStore, type MapStoreState } from '@/lib/store';
import { loadTrailJunctions, resetTrailJunctionsCache } from '@/lib/trail-junctions';
import { useDatasetFetch } from './useDatasetFetch';

/**
 * Loads the marked-trail junction dataset into the map store and revalidates it
 * on tab focus (useDatasetFetch). Silent on failure: the layer, toggle, and
 * data-book rows simply stay hidden (the dataset ships empty by default).
 */
export function useTrailJunctionsFetch(): void {
	const setTrailJunctionsFile = useMapStore((s: MapStoreState) => s.setTrailJunctionsFile);
	useDatasetFetch({ load: loadTrailJunctions, reset: resetTrailJunctionsCache, onData: setTrailJunctionsFile });
}
