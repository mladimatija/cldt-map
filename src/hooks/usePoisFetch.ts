'use client';

import { useEffect, useMemo } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { loadPois, resetPoisCache } from '@/lib/pois';

/** Minimum time since last successful fetch before a visibility-change triggers
 *  a cache reset and re-fetch. Matches the seasonal-status throttle pattern. */
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

/** Tracks when the last POI fetch completed so the visibility-change handler
 *  can skip the reset when the tab was only briefly hidden. */
let lastFetchedAt = 0;

/**
 * Fetches the POI dataset on mount and re-fetches when the tab becomes
 * visible again so a freshly-merged enrichment PR is picked up without a
 * full reload. Only resets the cache when the data is stale (> 5 minutes
 * since the last successful fetch), avoiding a redundant re-parse after a
 * brief tab switch.
 *
 * Fetches only the per-type files for the currently enabled POI types;
 * enabling another type triggers an incremental fetch of just that file
 * (already-loaded types are served from the module cache).
 */
export function usePoisFetch(): void {
	const setPoisFile = useMapStore((s: MapStoreState) => s.setPoisFile);
	const enabledPoiTypes = useMapStore((s: MapStoreState) => s.enabledPoiTypes);

	// Stable key so toggling Set identity without membership change (or a
	// disable, which needs no fetch - the superset stays valid) does not refire.
	const enabledKey = useMemo(() => [...enabledPoiTypes].sort().join(','), [enabledPoiTypes]);

	useEffect(() => {
		if (typeof window === 'undefined') return;

		const fetchData = async (): Promise<void> => {
			try {
				const types = new Set(enabledKey.split(',').filter((t) => t.length > 0));
				const file = await loadPois(types.size > 0 ? types : undefined);
				lastFetchedAt = Date.now();
				setPoisFile(file);
			} catch {
				// retain previous file on failure
			}
		};

		// The default POI set is ~3 MB of JSON (peaks alone are 1.7 MB with
		// baked Wikipedia summaries); fetching and parsing it during map
		// startup competes with the GPX parse and first tile paint. Defer the
		// INITIAL load to browser idle time - everything downstream (markers,
		// planner water stats, up-next strip) is reactive and simply fills in
		// a moment later. Subsequent enabled-type changes fetch immediately:
		// those are explicit user actions on a warm page.
		let idleHandle: number | null = null;
		let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
		if (lastFetchedAt === 0 && 'requestIdleCallback' in window) {
			idleHandle = window.requestIdleCallback(() => void fetchData(), { timeout: 4000 });
		} else if (lastFetchedAt === 0) {
			timeoutHandle = setTimeout(() => void fetchData(), 1500);
		} else {
			void fetchData();
		}

		const onVisibility = (): void => {
			if (document.visibilityState === 'visible') {
				if (Date.now() - lastFetchedAt >= STALE_THRESHOLD_MS) {
					resetPoisCache();
					void fetchData();
				}
			}
		};
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			if (idleHandle !== null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleHandle);
			if (timeoutHandle !== null) clearTimeout(timeoutHandle);
		};
	}, [setPoisFile, enabledKey]);
}
