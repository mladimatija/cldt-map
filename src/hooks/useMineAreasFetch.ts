import { useEffect } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import type { MineAreasFile } from '@/lib/mine-areas';

/**
 * Loads the bundled mine-suspected-area dataset once on mount. The file is a
 * static asset, so the service worker's network-first handler keeps it fresh
 * online and serves the cached copy offline - no polling needed.
 */
export function useMineAreasFetch(): void {
	const setMineAreasFile = useMapStore((s: MapStoreState) => s.setMineAreasFile);

	useEffect(() => {
		if (typeof window === 'undefined') return;
		let cancelled = false;

		const fetchData = async (): Promise<void> => {
			try {
				const res = await fetch('/data/mine-areas.json');
				if (!res.ok) return;
				const data = (await res.json()) as MineAreasFile;
				if (!cancelled && Array.isArray(data.areas)) setMineAreasFile(data);
			} catch {
				// Offline with a cold cache: the layer simply stays empty.
			}
		};

		void fetchData();
		return () => {
			cancelled = true;
		};
	}, [setMineAreasFile]);
}
