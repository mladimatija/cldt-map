'use client';

import localforage from 'localforage';
import { NetworkError } from '@/lib/utils';

// Configure localforage
localforage.config({
	name: 'cldt-map',
	storeName: 'gpx-cache',
});

const GPX_FETCH_TIMEOUT_MS = 90000; // proxy upstream (60s) + transfer for large GPX
const GPX_CACHE_KEY = 'gpx-data';

interface CachedGPX {
	data: string;
	version: string;
	timestamp: number;
	isFallback?: boolean;
}

interface GPXResult {
	data: string;
	source: 'network' | 'cache' | 'error';
	status: 'success' | 'fallback' | 'error';
	message?: string;
	timestamp?: number;
	version?: string;
}

function isOnline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine;
}

/**
 * Fetch URL as text with timeout. Throws NetworkError on failure or non-ok response.
 */
async function fetchText(url: string, timeoutMs: number): Promise<string> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: { Accept: 'application/xml, text/xml, */*' },
		});
		clearTimeout(timeoutId);
		if (!response.ok) {
			throw new NetworkError(`HTTP error ${response.status}: ${response.statusText}`);
		}
		return await response.text();
	} catch (err) {
		clearTimeout(timeoutId);
		if (err instanceof NetworkError) throw err;
		if (err instanceof Error) {
			if (err.name === 'AbortError') {
				throw new NetworkError('Request timed out');
			}
			throw new NetworkError(err.message);
		}
		throw new NetworkError('Failed to fetch data');
	}
}

/**
 * Fetches GPX data with caching support and fallback mechanisms.
 * Uses navigator.onLine for offline detection and fetch() for the request.
 */
export async function fetchGPXWithCache(): Promise<GPXResult> {
	const gpxUrl = process.env.NEXT_PUBLIC_GPX_URL;

	if (!gpxUrl) {
		return {
			data: '',
			source: 'error',
			status: 'error',
			message: 'GPX URL is not configured.',
		};
	}

	const cacheVersion = process.env.NEXT_PUBLIC_CACHE_VERSION || '1';

	try {
		const cachedData = await localforage.getItem<CachedGPX>(GPX_CACHE_KEY);

		if (cachedData?.version === cacheVersion) {
			return {
				data: cachedData.data,
				source: 'cache',
				status: 'success',
				timestamp: cachedData.timestamp,
				version: cachedData.version,
			};
		}

		if (!isOnline()) {
			if (!cachedData) {
				return {
					data: '',
					source: 'error',
					status: 'error',
					message: 'Offline and no cached data available.',
				};
			}
			return {
				data: cachedData.data,
				source: 'cache',
				status: 'fallback',
				message: 'Using outdated cache because device is offline.',
				timestamp: cachedData.timestamp,
				version: cachedData.version,
			};
		}

		const proxyBase =
			process.env.NEXT_PUBLIC_CORS_PROXY ??
			(typeof window !== 'undefined' ? `${window.location.origin}/api/proxy?url=` : '/api/proxy?url=');
		const fetchUrl = `${proxyBase}${encodeURIComponent(gpxUrl)}`;

		try {
			const data = await fetchText(fetchUrl, GPX_FETCH_TIMEOUT_MS);

			const newCache: CachedGPX = {
				data,
				version: cacheVersion,
				timestamp: Date.now(),
			};
			await localforage.setItem(GPX_CACHE_KEY, newCache);

			return {
				data,
				source: 'network',
				status: 'success',
				timestamp: newCache.timestamp,
				version: cacheVersion,
			};
		} catch (proxyError) {
			console.error('Error fetching GPX via proxy:', proxyError);

			if (cachedData) {
				await localforage.setItem(GPX_CACHE_KEY, {
					...cachedData,
					isFallback: true,
				});
				return {
					data: cachedData.data,
					source: 'cache',
					status: 'fallback',
					message: 'Proxy failed, using cached data.',
					timestamp: cachedData.timestamp,
					version: cachedData.version,
				};
			}

			throw proxyError;
		}
	} catch (error) {
		return {
			data: '',
			source: 'error',
			status: 'error',
			message:
				error instanceof NetworkError
					? error.message
					: error instanceof Error
						? error.message
						: 'Unknown error fetching GPX data',
		};
	}
}

/**
 * Clears the cached GPX data so the next fetch will request from the network.
 * Use after a load failure to allow retry without stale cache.
 */
export async function clearGPXCache(): Promise<void> {
	await localforage.removeItem(GPX_CACHE_KEY);
}

/**
 * Fetches GPX and parses to trail points. Used for dev features (e.g., fake location on trail)
 * when trail data may not be loaded (e.g., on Test Store page).
 */
export async function fetchAndParseTrailPoints(): Promise<{ lat: number; lng: number }[]> {
	const result = await fetchGPXWithCache();
	if (result.status === 'error' || !result.data) {
		return [];
	}
	// Parse GPX XML and read <trkpt lat="..." lon="..."> elements.
	const parser = new DOMParser();
	const gpxDoc = parser.parseFromString(result.data, 'text/xml');
	const trackpoints = gpxDoc.getElementsByTagName('trkpt');
	const points: { lat: number; lng: number }[] = [];
	for (let i = 0; i < trackpoints.length; i++) {
		const point = trackpoints[i];
		const lat = parseFloat(point.getAttribute('lat') || '0');
		const lng = parseFloat(point.getAttribute('lon') || '0');
		if (lat && lng) {
			points.push({ lat, lng });
		}
	}
	return points;
}
