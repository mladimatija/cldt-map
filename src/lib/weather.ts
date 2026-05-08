import type { UnitSystem } from '@/lib/types';

export interface HourlyEntry {
	time: Date;
	tempC: number;
	precipPct: number;
	windKmh: number;
}

export interface WeatherData {
	temperatureC: number;
	feelsLikeC: number;
	precipitationProbabilityPct: number;
	windspeedKmh: number;
	weatherCode: number;
	sunrise: string;
	sunset: string;
	/** UTC offset of the queried location in seconds (e.g. 7200 for UTC+2).
	 *  Required to correctly convert Open-Meteo's timezone-local ISO strings to UTC. */
	utcOffsetSeconds: number;
	hourly?: HourlyEntry[];
}

interface OpenMeteoResponse {
	utc_offset_seconds?: number;
	current?: {
		temperature_2m?: number;
		apparent_temperature?: number;
		windspeed_10m?: number;
		weathercode?: number;
	};
	hourly?: {
		time?: string[];
		temperature_2m?: number[];
		precipitation_probability?: number[];
		wind_speed_10m?: number[];
	};
	daily?: {
		sunrise?: string[];
		sunset?: string[];
	};
}

/** Fetches daily data from Open-Meteo (sunrise, sunset, precipitation probability). */
async function fetchOpenMeteo(lat: number, lng: number): Promise<WeatherData | null> {
	try {
		const params = new URLSearchParams({
			latitude: lat.toFixed(5),
			longitude: lng.toFixed(5),
			current: 'temperature_2m,apparent_temperature,windspeed_10m,weathercode',
			hourly: 'temperature_2m,precipitation_probability,wind_speed_10m',
			daily: 'sunrise,sunset',
			forecast_days: '1',
			forecast_hours: '12',
			timezone: 'auto',
		});
		const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
		if (!res.ok) return null;

		const json = (await res.json()) as OpenMeteoResponse;
		const current = json.current;
		const daily = json.daily;
		if (!current || !daily) return null;

		// Find the hourly precipitation probability for the current hour.
		const hourlyTimes = json.hourly?.time ?? [];
		const hourlyProb = json.hourly?.precipitation_probability ?? [];
		const now = Date.now();
		let precipPct = 0;
		if (hourlyTimes.length) {
			let closestIdx = 0;
			let closestDiff = Infinity;
			for (let i = 0; i < hourlyTimes.length; i++) {
				const diff = Math.abs(new Date(hourlyTimes[i]).getTime() - now);
				if (diff < closestDiff) {
					closestDiff = diff;
					closestIdx = i;
				}
			}
			precipPct = hourlyProb[closestIdx] ?? 0;
		}

		// Parse the full hourly forecast into HourlyEntry[].
		let hourly: HourlyEntry[] | undefined;
		try {
			const hTemps = json.hourly?.temperature_2m ?? [];
			const hProbs = json.hourly?.precipitation_probability ?? [];
			const hWinds = json.hourly?.wind_speed_10m ?? [];
			if (hourlyTimes.length > 0) {
				hourly = hourlyTimes.slice(0, 12).map((t, i) => ({
					time: new Date(t),
					tempC: hTemps[i] ?? 0,
					precipPct: hProbs[i] ?? 0,
					windKmh: hWinds[i] ?? 0,
				}));
			}
		} catch {
			// If parsing fails, hourly stays undefined.
		}

		return {
			temperatureC: current.temperature_2m ?? 0,
			feelsLikeC: current.apparent_temperature ?? 0,
			precipitationProbabilityPct: precipPct,
			windspeedKmh: current.windspeed_10m ?? 0,
			weatherCode: current.weathercode ?? 0,
			sunrise: daily.sunrise?.[0] ?? '',
			sunset: daily.sunset?.[0] ?? '',
			utcOffsetSeconds: json.utc_offset_seconds ?? 0,
			hourly,
		};
	} catch {
		return null;
	}
}

/**
 * Fetches current weather for a location.
 * Uses DHMZ (Croatian Met Service) as the primary source for real-time conditions
 * and supplements with Open-Meteo for daily fields (precipitation probability,
 * sunrise, sunset). Falls back to Open-Meteo entirely if DHMZ is unavailable.
 * Never throws.
 */
export async function fetchWeather(lat: number, lng: number): Promise<WeatherData | null> {
	try {
		const [dhmzResult, openMeteoResult] = await Promise.allSettled([
			fetch(`/api/dhmz-weather?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`).then((r) =>
				r.ok ? (r.json() as Promise<WeatherData>) : Promise.reject(r.status),
			),
			fetchOpenMeteo(lat, lng),
		]);

		const dhmz = dhmzResult.status === 'fulfilled' ? dhmzResult.value : null;
		const openMeteo = openMeteoResult.status === 'fulfilled' ? openMeteoResult.value : null;

		if (!dhmz && !openMeteo) return null;

		// DHMZ wins for fields it provides (temp, feelsLike, wind, weatherCode).
		// Open-Meteo fills fields DHMZ doesn't have (precipitation probability, sunrise, sunset).
		if (dhmz) {
			return {
				...dhmz,
				precipitationProbabilityPct: openMeteo?.precipitationProbabilityPct ?? 0,
				sunrise: openMeteo?.sunrise || dhmz.sunrise,
				sunset: openMeteo?.sunset || dhmz.sunset,
				utcOffsetSeconds: openMeteo?.utcOffsetSeconds ?? dhmz.utcOffsetSeconds ?? 0,
				hourly: openMeteo?.hourly,
			};
		}

		return openMeteo;
	} catch {
		return null;
	}
}

/**
 * Finds the longest contiguous block of hourly entries where precipitation
 * probability is strictly below the threshold.
 *
 * @returns `{ startIdx, endIdx }` (inclusive) for the first-longest qualifying
 *          window, or `null` if no window of at least `minHours` entries exists.
 */
export function findBestWindow(
	hourly: HourlyEntry[],
	thresholdPct = 30,
	minHours = 2,
): { startIdx: number; endIdx: number } | null {
	let bestStart = -1;
	let bestLen = 0;
	let curStart = -1;
	let curLen = 0;

	for (let i = 0; i < hourly.length; i++) {
		if (hourly[i].precipPct < thresholdPct) {
			if (curLen === 0) curStart = i;
			curLen++;
			if (curLen > bestLen) {
				bestStart = curStart;
				bestLen = curLen;
			}
		} else {
			curLen = 0;
		}
	}

	if (bestLen >= minHours) {
		return { startIdx: bestStart, endIdx: bestStart + bestLen - 1 };
	}
	return null;
}

/** Formats a temperature value (in °C) according to the user's unit system. */
export function formatTemperature(celsius: number, units: UnitSystem): string {
	if (units === 'imperial') {
		return `${((celsius * 9) / 5 + 32).toFixed(1)} °F`;
	}
	return `${celsius.toFixed(1)} °C`;
}

/** Formats a wind speed value (in km/h) according to the user's unit system. */
export function formatWindSpeed(kmh: number, units: UnitSystem): string {
	if (units === 'imperial') {
		return `${Math.round(kmh * 0.621371)} mph`;
	}
	return `${Math.round(kmh)} km/h`;
}

/**
 * Maps a WMO weather interpretation code to a translation key for the `weather` namespace.
 * Groups are intentionally broad - enough to be meaningful to a hiker at a glance.
 */
export function weatherCodeToKey(code: number): string {
	if (code === 0) return 'clear';
	if (code <= 3) return 'cloudy';
	if (code <= 48) return 'fog';
	if (code <= 67) return 'rain';
	if (code <= 77) return 'snow';
	if (code <= 82) return 'showers';
	if (code <= 86) return 'snowShowers';
	return 'thunderstorm';
}

const WEATHER_ICONS: Record<string, string> = {
	clear: '☀️',
	cloudy: '☁️',
	fog: '🌫️',
	rain: '🌧️',
	snow: '❄️',
	showers: '🌦️',
	snowShowers: '🌨️',
	thunderstorm: '⛈️',
};

export function weatherKeyToIcon(key: string): string {
	return WEATHER_ICONS[key] ?? '🌡️';
}

/** Formats an hour label compactly: "14:00" for metric, "2 PM" for imperial. */
export function formatHourlyTime(date: Date, units: UnitSystem): string {
	if (units === 'imperial') {
		return date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
	}
	return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatHourlyTimeShort(date: Date, units: UnitSystem): string {
	const h = date.getHours();
	if (units === 'imperial') {
		const h12 = h % 12 || 12;
		return `${h12}${h < 12 ? 'a' : 'p'}`;
	}
	return `${h}`;
}

export function formatCompactTemp(celsius: number, units: UnitSystem): string {
	if (units === 'imperial') {
		return `${Math.round((celsius * 9) / 5 + 32)}°`;
	}
	return `${Math.round(celsius)}°`;
}

/**
 * Computes the best-window hint parameters from hourly data and an optional window.
 *
 * @returns A discriminated union describing the hint, or `null` when no window exists.
 * - `{ type: 'drierWindow'; start: Date; end: Date }` — window starts within 30 min of now
 * - `{ type: 'bestToStartBy'; time: Date }` — window starts later
 */
export function computeBestWindowHintParams(
	hourly: HourlyEntry[],
	window: { startIdx: number; endIdx: number } | null,
): { type: 'drierWindow'; start: Date; end: Date } | { type: 'bestToStartBy'; time: Date } | null {
	if (!window) return null;
	const windowStart = hourly[window.startIdx].time;
	const windowEnd = hourly[window.endIdx].time;
	const now = Date.now();
	const diffMs = windowStart.getTime() - now;

	if (diffMs <= 30 * 60 * 1000) {
		return { type: 'drierWindow', start: windowStart, end: windowEnd };
	}
	return { type: 'bestToStartBy', time: windowStart };
}

/**
 * Formats a sunrise/sunset ISO datetime string (e.g. "2026-03-18T06:42") to a
 * time string. Metric units use 24 h format; imperial uses the locale default.
 */
export function formatSunTime(isoString: string, units: UnitSystem = 'metric'): string {
	if (!isoString) return '';
	try {
		return new Date(isoString).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			hour12: units === 'imperial' ? undefined : false,
		});
	} catch {
		return isoString.slice(11, 16);
	}
}
