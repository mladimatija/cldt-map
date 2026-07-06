import { useEffect } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { loadTrailJunctions } from '@/lib/trail-junctions';

/**
 * Loads the bundled marked-trail junction dataset once on mount and pushes it
 * into the map store. The file is a static asset, so the service worker's
 * network-first handler keeps it fresh online and serves the cached copy
 * offline - no polling needed. Silent on failure: the layer, toggle, and
 * data-book rows simply stay hidden (the dataset ships empty by default).
 */
export function useTrailJunctionsFetch(): void {
	const setTrailJunctionsFile = useMapStore((s: MapStoreState) => s.setTrailJunctionsFile);

	useEffect(() => {
		if (typeof window === 'undefined') return;
		let cancelled = false;

		const fetchData = async (): Promise<void> => {
			try {
				const file = await loadTrailJunctions();
				if (!cancelled && file) setTrailJunctionsFile(file);
			} catch {
				// Offline with a cold cache: the layer simply stays empty.
			}
		};

		void fetchData();
		return () => {
			cancelled = true;
		};
	}, [setTrailJunctionsFile]);
}
