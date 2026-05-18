import { useEffect } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { loadSeasonalStatus, resetSeasonalStatusCache } from '@/lib/seasonal-status';

/**
 * Fetches seasonal trail status entries from /seasonal-status.json (or the configured
 * remote URL) on mount, and re-fetches when the tab becomes visible again. Malformed
 * or unreachable data sets the file to null - callers should treat null as "no data,
 * hide the layer".
 */
export function useSeasonalStatusFetch(): void {
	const setSeasonalStatusFile = useMapStore((s: MapStoreState) => s.setSeasonalStatusFile);

	useEffect(() => {
		if (typeof window === 'undefined') return;

		const fetchData = async (): Promise<void> => {
			try {
				const file = await loadSeasonalStatus();
				setSeasonalStatusFile(file);
			} catch {
				// Retain previous file on failure
			}
		};

		void fetchData();

		const onVisibility = (): void => {
			if (document.visibilityState === 'visible') {
				resetSeasonalStatusCache();
				void fetchData();
			}
		};
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}, [setSeasonalStatusFile]);
}
