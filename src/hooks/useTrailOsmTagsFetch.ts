'use client';

import { useEffect } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { loadTrailOsmTags, resetTrailOsmTagsCache } from '@/lib/trail-osm-tags';

/**
 * Fires once on mount and pushes the OSM tag dataset into the map store.
 * Mirrors useSeasonalStatusFetch: no-op on the server, fetches once via
 * the loader cache, and re-fetches when the tab becomes visible again so
 * a freshly merged enrichment PR is picked up without a full reload.
 * Silent on failure - the renderer treats a null dataset as "feature
 * unavailable" and falls back to default trail styling.
 */
export function useTrailOsmTagsFetch(): void {
	const setTrailOsmTagsFile = useMapStore((s: MapStoreState) => s.setTrailOsmTagsFile);

	useEffect(() => {
		if (typeof window === 'undefined') return;

		const fetchData = async (): Promise<void> => {
			try {
				const file = await loadTrailOsmTags();
				setTrailOsmTagsFile(file);
			} catch {
				// Retain previous file on failure
			}
		};

		void fetchData();

		const onVisibility = (): void => {
			if (document.visibilityState === 'visible') {
				resetTrailOsmTagsCache();
				void fetchData();
			}
		};
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}, [setTrailOsmTagsFile]);
}
