import type { UnitSystem } from '@/lib/types';

export interface WeatherData {
	temperatureC: number;
	feelsLikeC: number;
	precipitationProbabilityPct: number;
	windspeedKmh: number;
	weatherCode: number;
	sunrise: string;
	sunset: string;
}

interface OpenMeteoResponse {
	current?: {
		temperature_2m?: number;
		apparent_temperature?: number;
		windspeed_10m?: number;
		weathercode?: number;
	};
	hourly?: {
		time?: string[];
		precipitation_probability?: number[];
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
			hourly: 'precipitation_probability',
			daily: 'sunrise,sunset',
			forecast_days: '1',
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

		return {
			temperatureC: current.temperature_2m ?? 0,
			feelsLikeC: current.apparent_temperature ?? 0,
			precipitationProbabilityPct: precipPct,
			windspeedKmh: current.windspeed_10m ?? 0,
			weatherCode: current.weathercode ?? 0,
			sunrise: daily.sunrise?.[0] ?? '',
			sunset: daily.sunset?.[0] ?? '',
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
				sunrise: openMeteo?.sunrise ?? '',
				sunset: openMeteo?.sunset ?? '',
			};
		}

		return openMeteo;
	} catch {
		return null;
	}
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
 * Groups are intentionally broad — enough to be meaningful to a hiker at a glance.
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
