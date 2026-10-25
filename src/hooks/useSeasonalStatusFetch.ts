import { useMapStore, type MapStoreState } from '@/lib/store';
import { loadSeasonalStatus, resetSeasonalStatusCache } from '@/lib/seasonal-status';
import { useDatasetFetch } from './useDatasetFetch';

/**
 * Loads the seasonal trail status (remote override or bundled file) into the
 * store on mount and revalidates it on tab focus (useDatasetFetch). Until a
 * dataset loads the store holds null, which callers treat as "no data, hide the
 * layer".
 */
export function useSeasonalStatusFetch(): void {
	const setSeasonalStatusFile = useMapStore((s: MapStoreState) => s.setSeasonalStatusFile);
	useDatasetFetch({ load: loadSeasonalStatus, reset: resetSeasonalStatusCache, onData: setSeasonalStatusFile });
}
