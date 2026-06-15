import { useEffect, useRef, useState } from 'react';
import { useStore, useMapStore, type StoreState, type MapStoreState } from '@/lib/store';
import { TRAIL_OFF_TRAIL_THRESHOLD_M } from '@/lib/config';
import { fetchWeather, type WeatherData } from '@/lib/weather';

export interface TrailSunWeather {
	/** Daylight data for the current on-trail position, or null when off-trail/disabled. */
	weatherData: WeatherData | null;
	/** Wall-clock captured at the moment weatherData was fetched, for time-of-day deltas. */
	nowMs: number;
	/** True when a GPS fix places the hiker within the on-trail threshold and the consumer is enabled. */
	isOnTrail: boolean;
}

const SUN_WEATHER_THROTTLE_MS = 30_000;

// Two-level throttle: each consumer keeps a per-instance fetchedAtRef (in the hook
// below) so it re-reads at most once per window, and this module-level cache dedups
// across consumers (the sunrise/sunset projection markers and the daylight budget
// chip) so they share a single in-flight weather request per ~100 m location bucket
// rather than each firing its own. A simultaneous first mount resolves to one promise.
let sharedKey = '';
let sharedAt = 0;
let sharedPromise: Promise<WeatherData | null> | null = null;

function sharedSunWeather(lat: number, lng: number): Promise<WeatherData | null> {
	const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
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
	const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
	const [nowMs, setNowMs] = useState(() => Date.now());

	const isOnTrail = enabled && !!closestPoint && closestPoint.distance <= TRAIL_OFF_TRAIL_THRESHOLD_M && !!userLocation;

	useEffect(() => {
		if (!isOnTrail || !userLocation) {
			fetchedAtRef.current = 0;
			return;
		}
		if (Date.now() - fetchedAtRef.current < SUN_WEATHER_THROTTLE_MS) return;
		fetchedAtRef.current = Date.now();
		let cancelled = false;
		void sharedSunWeather(userLocation.lat, userLocation.lng).then((data) => {
			if (cancelled) return;
			setNowMs(Date.now());
			setWeatherData(data);
		});
		return () => {
			cancelled = true;
		};
	}, [isOnTrail, userLocation]);

	return { weatherData: isOnTrail ? weatherData : null, nowMs, isOnTrail };
}
