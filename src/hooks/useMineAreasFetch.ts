import { useMapStore, type MapStoreState } from '@/lib/store';
import { loadMineAreas, resetMineAreasCache } from '@/lib/mine-areas';
import { useDatasetFetch } from './useDatasetFetch';

/**
 * Loads the bundled mine-suspected-area dataset into the map store and
 * revalidates it on tab focus (useDatasetFetch). Offline with a cold cache the
 * layer simply stays empty.
 */
export function useMineAreasFetch(): void {
	const setMineAreasFile = useMapStore((s: MapStoreState) => s.setMineAreasFile);
	useDatasetFetch({ load: loadMineAreas, reset: resetMineAreasCache, onData: setMineAreasFile });
}
