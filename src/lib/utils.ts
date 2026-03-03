/**
 * Consolidated utility functions
 *
 * This file serves as the central place for all utility functions.
 */

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useStore, useMapStore } from '@/lib/store';
import { config } from '@/lib/config';
import type { TrailDirection, UnitSystem } from '@/lib/types';

export type { UnitSystem };

// --------------------------------------
// Core utilities
// --------------------------------------

/**
 * Combines className strings and Tailwind utility classes
 * Uses clsx to combine class values and twMerge to handle Tailwind-specific merging
 */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

// --------------------------------------
// Error handling utilities
// --------------------------------------

/**
 * Base error class for application errors
 * Provides standardized error handling with code, status, and optional details
 */
class AppError extends Error {
	constructor(
		message: string,
		public code: string,
		public status: number = 500,
		public details?: unknown,
	) {
		super(message);
		this.name = 'AppError';

		// Ensure a prototype chain is properly maintained in transpiled code
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}
	}
}

/**
 * Error class for location-related errors
 */
export class LocationError extends AppError {
	constructor(message: string, details?: unknown) {
		super(message, 'LOCATION_ERROR', 400, details);
		this.name = 'LocationError';
	}
}

/**
 * Error class for map-related errors
 */
export class MapError extends AppError {
	constructor(message: string, details?: unknown) {
		super(message, 'MAP_ERROR', 400, details);
		this.name = 'MapError';
	}
}

/**
 * Error class for network-related errors
 */
export class NetworkError extends AppError {
	constructor(message: string, details?: unknown) {
		super(message, 'NETWORK_ERROR', 503, details);
		this.name = 'NetworkError';
	}
}

/**
 * Shape used by store for locationError. Shared by location-slice and map-store.
 */
export function toLocationError(error: unknown, fallbackMessage: string): { code: number; message: string } {
	return {
		code: 0,
		message: error instanceof Error ? error.message : fallbackMessage,
	};
}

// --------------------------------------
// Units conversion utilities
// --------------------------------------

interface Conversions {
	distance: (value: number) => number;
	elevation: (value: number) => number;
}

const toImperial: Conversions = {
	distance: (km: number): number => km * 0.621371,
	elevation: (meters: number): number => meters * 3.28084,
};

/**
 * Format distance with appropriate units
 *
 * @param distance Distance in kilometers (for metric) or meters (if needsConversion is true)
 * @param units Unit system to use (metric or imperial)
 * @param precision Number of decimal places; when undefined, uses store's distancePrecision (default 2)
 * @param needsConversion If true, treats the distance as meters and converts to km first
 * @returns Formatted distance string with units
 */
export function formatDistance(
	distance: number,
	units?: UnitSystem,
	precision?: number,
	needsConversion: boolean = false,
): string {
	// Allow use without passing units: read from Zustand store when in browser (SSR-safe).
	if (units === undefined) {
		units = 'metric';
		if (typeof window !== 'undefined') {
			try {
				const store = useStore.getState?.();
				if (store?.units) {
					units = store.units;
				}
			} catch {
				// Use default when store not ready (e.g., SSR)
			}
		}
	}

	// Precision can come from store (user preference) or config default; avoid store access during SSR.
	if (precision === undefined) {
		precision = config.distancePrecision;
		if (typeof window !== 'undefined') {
			try {
				const mapState = useMapStore?.getState?.();
				if (typeof mapState?.distancePrecision === 'number') {
					precision = mapState.distancePrecision;
				}
			} catch {
				// Use config default when store not ready
			}
		}
	}

	let value = needsConversion ? distance / 1000 : distance;
	if (units === 'imperial') {
		value = toImperial.distance(value);
	}
	return `${value.toFixed(precision)} ${units === 'imperial' ? 'mi' : 'km'}`;
}

/**
 * Format elevation with appropriate units
 *
 * @param elevation Elevation in meters
 * @param units Unit system to use (metric or imperial)
 * @param precision Number of decimal places for formatted output
 * @returns Formatted elevation string with units
 */
export function formatElevation(elevation: number, units?: UnitSystem, precision: number = 0): string {
	// If units not provided via parameter, try to get from the store
	if (units === undefined) {
		// Default to metric
		units = 'metric';

		// Only try to access the store in a browser environment
		if (typeof window !== 'undefined') {
			try {
				const store = useStore.getState?.();
				if (store?.units) {
					units = store.units;
				}
			} catch (_e) {
				// Use the default
			}
		}
	}

	// Convert to imperial if needed
	let value = elevation;
	if (units === 'imperial') {
		value = toImperial.elevation(value);
	}

	// Format the number - round to whole numbers
	const formatted = value.toFixed(precision);

	// Add the unit and return
	return `${formatted} ${units === 'imperial' ? 'ft' : 'm'}`;
}

/** Croatia bounding box (same as isWithinMapBoundary) */
const BOUNDARY_LAT_MIN = 42.3;
const BOUNDARY_LAT_MAX = 46.5;
const BOUNDARY_LNG_MIN = 13.5;
const BOUNDARY_LNG_MAX = 19.5;

/**
 * Generate a random point within the map boundary (Croatia)
 * Used for dev-mode fake user location.
 *
 * @returns Location object with lat, lng
 */
export function getRandomLocationInBoundary(): { lat: number; lng: number } {
	const lat = BOUNDARY_LAT_MIN + Math.random() * (BOUNDARY_LAT_MAX - BOUNDARY_LAT_MIN);
	const lng = BOUNDARY_LNG_MIN + Math.random() * (BOUNDARY_LNG_MAX - BOUNDARY_LNG_MIN);
	return { lat, lng };
}

/**
 * Detect if the user is on a mobile device (phone or tablet)
 */
function isMobile(): boolean {
	if (typeof navigator === 'undefined') return false;
	return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Build a navigation URL from the user's current location to a destination point.
 * On mobile: uses geo: URI to open the device's default maps app (whatever the user has installed).
 * On desktop: uses Google Maps in the browser.
 *
 * @param originLat User's current latitude
 * @param originLng User's current longitude
 * @param destLat Destination latitude
 * @param destLng Destination longitude
 * @returns URL to open for navigation
 */
export function getNavigateToPointUrl(originLat: number, originLng: number, destLat: number, destLng: number): string {
	if (isMobile()) {
		return `geo:${destLat},${destLng}`;
	}
	return `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}`;
}

/** Short keys for base map used in share URLs (e.g. standard, topo, croatiaTopo) */
export type ShareBaseMapKey = 'standard' | 'topo' | 'satellite' | 'terrain' | 'cycling' | 'croatiaTopo';

/**
 * Build a shareable URL with the current map view (center, zoom, direction, style)
 */
export function buildShareViewUrl(
	baseUrl: string,
	params: {
		lat: number;
		lng: number;
		zoom: number;
		direction?: TrailDirection;
		baseMap?: ShareBaseMapKey;
		sections?: boolean;
		dark?: boolean;
	},
): string {
	const url = new URL(baseUrl);
	url.searchParams.set('lat', params.lat.toFixed(5));
	url.searchParams.set('lng', params.lng.toFixed(5));
	url.searchParams.set('zoom', String(params.zoom));
	if (params.direction) {
		url.searchParams.set('dir', params.direction);
	}
	if (params.baseMap) {
		url.searchParams.set('baseMap', params.baseMap);
	}
	if (params.sections !== undefined) {
		url.searchParams.set('sections', params.sections ? '1' : '0');
	}
	if (params.dark !== undefined) {
		url.searchParams.set('dark', params.dark ? '1' : '0');
	}
	return url.toString();
}

/**
 * Build a shareable URL with progress (distance from start in km, direction, unit, zoom, style).
 * Total is not needed: we find the point by matching progress (km) to distanceFromStart.
 */
export function buildShareProgressUrl(
	baseUrl: string,
	params: {
		kmFromStart: number;
		direction: TrailDirection;
		unit?: 'km' | 'mi';
		zoom?: number;
		baseMap?: ShareBaseMapKey;
		sections?: boolean;
		dark?: boolean;
	},
): string {
	const url = new URL(baseUrl);
	url.searchParams.set('progress', params.kmFromStart.toFixed(2));
	url.searchParams.set('dir', params.direction);
	if (params.unit) {
		url.searchParams.set('unit', params.unit);
	}
	if (params.zoom !== null && params.zoom !== undefined) {
		url.searchParams.set('zoom', String(params.zoom));
	}
	if (params.baseMap) {
		url.searchParams.set('baseMap', params.baseMap);
	}
	if (params.sections !== undefined) {
		url.searchParams.set('sections', params.sections ? '1' : '0');
	}
	if (params.dark !== undefined) {
		url.searchParams.set('dark', params.dark ? '1' : '0');
	}
	return url.toString();
}

/** Share URL param keys that we add/remove */
const SHARE_URL_PARAMS = ['lat', 'lng', 'zoom', 'dir', 'progress', 'unit', 'baseMap', 'sections', 'dark'] as const;

/**
 * Remove share URL params from the current location (clean URL when the share tooltip is closed)
 */
export function clearShareUrlParams(): void {
	if (typeof window === 'undefined') return;
	const params = new URLSearchParams(window.location.search);
	let changed = false;
	for (const key of SHARE_URL_PARAMS) {
		if (params.has(key)) {
			params.delete(key);
			changed = true;
		}
	}
	if (changed) {
		const url = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
		window.history.replaceState({}, '', url);
	}
}

const VALID_SHARE_BASE_MAP_KEYS = new Set<ShareBaseMapKey>([
	'standard',
	'topo',
	'satellite',
	'terrain',
	'cycling',
	'croatiaTopo',
]);

/**
 * Parse share URL params from the current location. Returns null if no share-related params are present.
 */
export function parseShareUrlParams(): {
	lat?: number;
	lng?: number;
	zoom?: number;
	dir?: TrailDirection;
	progress?: number;
	unit?: 'km' | 'mi';
	baseMap?: ShareBaseMapKey;
	sections?: boolean;
	dark?: boolean;
} | null {
	if (typeof window === 'undefined') return null;
	const params = new URLSearchParams(window.location.search);
	const lat = params.get('lat');
	const lng = params.get('lng');
	const zoom = params.get('zoom');
	const dir = params.get('dir');
	const progress = params.get('progress');
	const unit = params.get('unit');
	const baseMap = params.get('baseMap');
	const sections = params.get('sections');
	const dark = params.get('dark');
	if (!lat && !lng && !zoom && !progress && !baseMap && !sections && !dark) return null;
	return {
		...(lat && lng && { lat: parseFloat(lat), lng: parseFloat(lng) }),
		...(zoom && { zoom: parseFloat(zoom) }),
		...(dir && (dir === 'NOBO' || dir === 'SOBO') && { dir }),
		...(progress && { progress: parseFloat(progress) }),
		...(unit && (unit === 'km' || unit === 'mi') && { unit: unit }),
		...(baseMap &&
			VALID_SHARE_BASE_MAP_KEYS.has(baseMap as ShareBaseMapKey) && {
				baseMap: baseMap as ShareBaseMapKey,
			}),
		...(sections !== null &&
			sections !== undefined && {
				sections: sections === '1',
			}),
		...(dark !== null &&
			dark !== undefined && {
				dark: dark === '1',
			}),
	};
}

/**
 * Check if a geographic point is within the map boundary (Croatia)
 *
 * @param latitude Latitude of the point to check
 * @param longitude Longitude of the point to check
 * @returns Boolean indicating if the point is within the map boundary
 */
export function isWithinMapBoundary(latitude: number, longitude: number): boolean {
	try {
		// Simple bounding box check for Croatia:
		// 42.3 to 46.5 latitude
		// 13.5 to 19.5 longitude
		return (
			latitude >= BOUNDARY_LAT_MIN &&
			latitude <= BOUNDARY_LAT_MAX &&
			longitude >= BOUNDARY_LNG_MIN &&
			longitude <= BOUNDARY_LNG_MAX
		);

		// Note: For a more accurate check, you'd want to use:
		// 1. GeoJSON boundary data with a point-in-polygon algorithm
		// 2. Or a library like Turf.js with booleanPointInPolygon
	} catch (error) {
		console.error('Error checking if point is within map boundary:', error);
		return true; // Default to true to avoid blocking functionality
	}
}
