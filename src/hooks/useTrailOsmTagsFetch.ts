'use client';

import { useMapStore, type MapStoreState } from '@/lib/store';
import { loadTrailOsmTags, resetTrailOsmTagsCache } from '@/lib/trail-osm-tags';
import { useDatasetFetch } from './useDatasetFetch';

/**
 * Loads the OSM tag dataset into the map store and revalidates it on tab focus
 * (useDatasetFetch), so a freshly merged enrichment PR is picked up without a
 * reload. Until a dataset lands the renderer treats null as "feature
 * unavailable" and falls back to default trail styling; afterwards a failed
 * revalidation keeps the last good dataset, so the style is never downgraded.
 *
 * The 293 KB dataset only matters for the Surface and SAC styles (off by
 * default), so it loads at browser idle time unless one of them is on. It must
 * still load eventually: the settings panel offers those styles only once the
 * dataset exists.
 */
export function useTrailOsmTagsFetch(): void {
	const setTrailOsmTagsFile = useMapStore((s: MapStoreState) => s.setTrailOsmTagsFile);
	const surfaceColoured = useMapStore((s: MapStoreState) => s.surfaceColoured);
	const sacColoured = useMapStore((s: MapStoreState) => s.sacColoured);
	useDatasetFetch({
		load: loadTrailOsmTags,
		reset: resetTrailOsmTagsCache,
		onData: setTrailOsmTagsFile,
		deferUntilIdle: !surfaceColoured && !sacColoured,
	});
}

/**
 * Starts the dataset load right away when the saved trail style needs it. The
 * map, and with it the hook above, mounts about a second after the page, while
 * the route is drawn as soon as the cached trail is read: without this head
 * start the route is drawn in the fallback style first and again when the tags
 * land. The hook then gets the same pending load.
 */
export function preloadTrailOsmTagsForSavedStyle(): void {
	const { surfaceColoured, sacColoured } = useMapStore.getState();
	if (surfaceColoured || sacColoured) void loadTrailOsmTags();
}
