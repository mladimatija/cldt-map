'use client';

import { useEffect } from 'react';
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
 * since the last successful fetch), avoiding a redundant 2.7 MB re-parse
 * after a brief tab switch.
 */
export function usePoisFetch(): void {
	const setPoisFile = useMapStore((s: MapStoreState) => s.setPoisFile);

	useEffect(() => {
		if (typeof window === 'undefined') return;

		const fetchData = async (): Promise<void> => {
			try {
				const file = await loadPois();
				lastFetchedAt = Date.now();
				setPoisFile(file);
			} catch {
				// retain previous file on failure
			}
		};

		void fetchData();

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
		};
	}, [setPoisFile]);
}
