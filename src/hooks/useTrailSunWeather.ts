import { useEffect, useRef, useState } from 'react';
import { useStore, useMapStore, type StoreState, type MapStoreState } from '@/lib/store';
import { TRAIL_OFF_TRAIL_THRESHOLD_M } from '@/lib/config';
import { fetchWeather, type WeatherData } from '@/lib/weather';

export interface TrailSunWeather {
	/** Daylight data for the current on-trail position, or null when off-trail/disabled. */
	weatherData: WeatherData | null;
	/** Wall-clock at the latest position update (or fetch), for time-of-day deltas. */
	nowMs: number;
	/** True when a GPS fix places the hiker within the on-trail threshold and the consumer is enabled. */
	isOnTrail: boolean;
}

/** Sunrise and sunset barely move along the trail, and live tracking updates
 *  the position every few seconds, so weather is refetched on this window only. */
const SUN_WEATHER_THROTTLE_MS = 10 * 60_000;
const SUN_WEATHER_RETRY_MS = 60_000;

// Two-level throttle: each consumer keeps a per-instance fetchedAtRef (in the hook
// below) so it re-reads at most once per window, and this module-level cache dedups
// across consumers (the sunrise/sunset projection markers and the daylight budget
// chip) so they share a single in-flight weather request per ~1 km location bucket
// rather than each firing its own. A simultaneous first mount resolves to one promise.
let sharedKey = '';
let sharedAt = 0;
let sharedPromise: Promise<WeatherData | null> | null = null;

function sharedSunWeather(lat: number, lng: number): Promise<WeatherData | null> {
	const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
	const now = Date.now();
	if (sharedPromise && sharedKey === key && now - sharedAt < SUN_WEATHER_THROTTLE_MS) {
		return sharedPromise;
	}
	sharedKey = key;
	sharedAt = now;
	// fetchWeather resolves to null on failure (it never rejects). Drop a failed result
	// from the cache so the next call can retry immediately instead of pinning a null.
	sharedPromise = fetchWeather(lat, lng).then((data) => {
		if (data === null && sharedKey === key) {
			sharedKey = '';
			sharedAt = 0;
			sharedPromise = null;
		}
		return data;
	});
	return sharedPromise;
}

/**
 * Fetches Open-Meteo daylight data for the hiker's current on-trail position,
 * throttled per consumer and deduped across consumers. Returns null weather when
 * off-trail or when `enabled` is false, so callers can mount it unconditionally
 * and gate purely on the returned `weatherData`.
 */
export function useTrailSunWeather(enabled: boolean): TrailSunWeather {
	const closestPoint = useStore((state: StoreState) => state.closestPoint);
	const userLocation = useMapStore((state: MapStoreState) => state.userLocation);
	const fetchedAtRef = useRef<number>(0);
	/** Bumped for each fetch and when leaving the trail or unmounting; a result
	 *  applies only while its id is current. A later position update does not
	 *  bump it, so a slow fetch still lands while the hiker keeps walking. */
	const requestIdRef = useRef(0);
	const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
	const [nowMs, setNowMs] = useState(() => Date.now());

	const isOnTrail = enabled && !!closestPoint && closestPoint.distance <= TRAIL_OFF_TRAIL_THRESHOLD_M && !!userLocation;

	useEffect(() => {
		const requestIds = requestIdRef;
		return () => {
			requestIds.current += 1;
		};
	}, []);

	useEffect(() => {
		if (!isOnTrail || !userLocation) {
			fetchedAtRef.current = 0;
			requestIdRef.current += 1;
			return;
		}
		if (Date.now() - fetchedAtRef.current < SUN_WEATHER_THROTTLE_MS) {
			// Between fetches keep the clock moving, so a time-of-day margin
			// (daylight left) is measured from now, not from the last fetch.
			setNowMs(Date.now());
			return;
		}
		fetchedAtRef.current = Date.now();
		requestIdRef.current += 1;
		const requestId = requestIdRef.current;
		void sharedSunWeather(userLocation.lat, userLocation.lng).then((data) => {
			if (requestId !== requestIdRef.current) return;
			// A failed fetch retries after a minute instead of the full window.
			if (data === null) fetchedAtRef.current = Date.now() - SUN_WEATHER_THROTTLE_MS + SUN_WEATHER_RETRY_MS;
			setNowMs(Date.now());
			setWeatherData(data);
		});
	}, [isOnTrail, userLocation]);

	return { weatherData: isOnTrail ? weatherData : null, nowMs, isOnTrail };
}
