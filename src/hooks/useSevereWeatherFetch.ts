import { useEffect } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';

const FETCH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Fetches severe weather data from /api/meteoalarm on mount and at a 15-minute interval.
 * Skips fetch when the app is offline. On failure, retains the previous data.
 */
export function useSevereWeatherFetch(): void {
	const setSevereWeatherData = useMapStore((s: MapStoreState) => s.setSevereWeatherData);

	useEffect(() => {
		if (typeof window === 'undefined') return;

		const fetchData = async (): Promise<void> => {
			if (useMapStore.getState().isOffline) return;
			try {
				const res = await fetch('/api/meteoalarm');
				if (!res.ok) return;
				const data = await res.json();
				setSevereWeatherData(data);
			} catch {
				// Retain previous data on failure
			}
		};

		void fetchData();

		const interval = setInterval(() => {
			void fetchData();
		}, FETCH_INTERVAL_MS);

		return () => {
			clearInterval(interval);
		};
	}, [setSevereWeatherData]);
}
