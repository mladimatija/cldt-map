import { useEffect, useRef } from 'react';
import { useLocale } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { isInCroatiaBbox } from '@/lib/geo-bounds';
import { joinWarningRegions, type SevereWeatherResponse, type WarningRegionsFile } from '@/lib/severe-weather';

const FETCH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
/** Response shape version, part of the URL: browsers and the CDN keep a
 *  response for 15 minutes, so a new shape needs a new cache key. */
const RESPONSE_VERSION = 2;
/** Timer ticks land a little early or late; this keeps a tick from being
 *  skipped as "too soon" and the refresh from slipping to 30 minutes. */
const INTERVAL_SLACK_MS = 30_000;

/** The county outlines, loaded once per page: they change only with a rebuild. */
let regionsPromise: Promise<WarningRegionsFile> | null = null;

function loadRegions(): Promise<WarningRegionsFile> {
	regionsPromise ??= fetch('/data/meteoalarm-regions-hr.json').then((res) => {
		if (!res.ok) throw new Error(`regions HTTP ${res.status}`);
		return res.json() as Promise<WarningRegionsFile>;
	});
	// A failed load is retried on the next fetch rather than cached.
	regionsPromise.catch(() => {
		regionsPromise = null;
	});
	return regionsPromise;
}

/**
 * Fetches severe-weather warnings from /api/meteoalarm in the UI language, then
 * every 15 minutes, but only while someone needs them: the warning layer is on,
 * or there is a GPS fix in Croatia (the banner warns the hiker for the county
 * they are in). Polling pauses while the tab is hidden and catches up when it
 * is shown again. Skips the fetch offline; on failure keeps the previous data.
 */
export function useSevereWeatherFetch(): void {
	const locale = useLocale();
	const setSevereWeatherData = useMapStore((s: MapStoreState) => s.setSevereWeatherData);
	const layerEnabled = useMapStore((s: MapStoreState) => s.severeWeatherLayer);
	const fixInCroatia = useMapStore(
		(s: MapStoreState) => !!s.userLocation && isInCroatiaBbox(s.userLocation.lat, s.userLocation.lng),
	);
	const needed = layerEnabled || fixInCroatia;
	/** Locale and start time of the last successful fetch; a new locale refetches at once. */
	const lastFetchRef = useRef<{ locale: string; at: number } | null>(null);

	useEffect(() => {
		if (typeof window === 'undefined' || !needed) return;
		const controller = new AbortController();

		const fetchData = async (): Promise<void> => {
			if (useMapStore.getState().isOffline || document.visibilityState === 'hidden') return;
			const last = lastFetchRef.current;
			if (last?.locale === locale && Date.now() - last.at < FETCH_INTERVAL_MS - INTERVAL_SLACK_MS) return;
			const startedAt = Date.now();
			try {
				const [regions, res] = await Promise.all([
					loadRegions(),
					fetch(`/api/meteoalarm?locale=${encodeURIComponent(locale)}&v=${RESPONSE_VERSION}`, {
						signal: controller.signal,
					}),
				]);
				if (!res.ok) return;
				const response = (await res.json()) as SevereWeatherResponse;
				// A request from before a locale change (or an unmount) must not land.
				if (controller.signal.aborted) return;
				lastFetchRef.current = { locale, at: startedAt };
				setSevereWeatherData(joinWarningRegions(regions, response));
			} catch {
				// Retain previous data on failure (including an aborted request)
			}
		};

		void fetchData();
		const interval = setInterval(() => void fetchData(), FETCH_INTERVAL_MS);
		const onVisibilityChange = (): void => {
			if (document.visibilityState === 'visible') void fetchData();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);

		return () => {
			controller.abort();
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVisibilityChange);
		};
	}, [needed, locale, setSevereWeatherData]);
}
