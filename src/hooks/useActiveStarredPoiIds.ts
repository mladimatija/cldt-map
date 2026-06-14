import { useMemo } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { getActiveStarredPoiIds } from '@/lib/store/types';

/** POI ids in the currently active starred collection. */
export function useActiveStarredPoiIds(): ReadonlySet<string> {
	const starredPoiCollections = useMapStore((s: MapStoreState) => s.starredPoiCollections);
	const activeStarredCollectionId = useMapStore((s: MapStoreState) => s.activeStarredCollectionId);
	return useMemo(
		() => getActiveStarredPoiIds({ starredPoiCollections, activeStarredCollectionId }),
		[starredPoiCollections, activeStarredCollectionId],
	);
}
