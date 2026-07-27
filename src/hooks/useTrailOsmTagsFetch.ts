'use client';

import { useEffect } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { loadTrailOsmTags, resetTrailOsmTagsCache } from '@/lib/trail-osm-tags';

/**
 * Fires once on mount and pushes the OSM tag dataset into the map store.
 * no-op on the server, fetches once via the loader cache, and re-fetches
 * when the tab becomes visible again so a freshly merged enrichment PR
 * is picked up without a full reload. Silent on failure - the renderer
 * treats a null dataset as "feature unavailable" and falls back to
 * default trail styling.
 */
export function useTrailOsmTagsFetch(): void {
	const setTrailOsmTagsFile = useMapStore((s: MapStoreState) => s.setTrailOsmTagsFile);
	const surfaceColoured = useMapStore((s: MapStoreState) => s.surfaceColoured);
	const sacColoured = useMapStore((s: MapStoreState) => s.sacColoured);

	useEffect(() => {
		if (typeof window === 'undefined') return;

		const fetchData = async (): Promise<void> => {
			try {
				// loadTrailOsmTags swallows its own fetch/parse errors and resolves to
				// null, so this catch only covers unexpected throws. Publishing null is
				// safe either way: the store setter keeps the previously published
				// dataset rather than replacing it with null.
				const file = await loadTrailOsmTags();
				setTrailOsmTagsFile(file);
			} catch {
				// Nothing to do; the store still holds the last good dataset.
			}
		};

		// The 293 KB tag dataset only matters when Surface/SAC coloring is on
		// (off by default). When a persisted session already uses one of the
		// modes, fetch immediately; otherwise defer to browser idle so the
		// download and parse stay off the startup critical path. It must
		// still load eventually - the settings panel disables the Surface and
		// SAC options until the dataset exists, so a hard gate would deadlock
		// the feature for new users.
		let idleHandle: number | null = null;
		let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
		if (surfaceColoured || sacColoured) {
			void fetchData();
		} else if ('requestIdleCallback' in window) {
			idleHandle = window.requestIdleCallback(() => void fetchData(), { timeout: 6000 });
		} else {
			timeoutHandle = setTimeout(() => void fetchData(), 2500);
		}

		const onVisibility = (): void => {
			if (document.visibilityState === 'visible') {
				resetTrailOsmTagsCache();
				void fetchData();
			}
		};
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			if (idleHandle !== null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleHandle);
			if (timeoutHandle !== null) clearTimeout(timeoutHandle);
		};
		// surfaceColoured/sacColoured deliberately excluded: they only choose
		// the INITIAL timing; the loader cache makes a re-run a no-op anyway.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [setTrailOsmTagsFile]);
}
