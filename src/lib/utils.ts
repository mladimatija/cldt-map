/**
 * Consolidated utility functions
 *
 * This file serves as the central place for all utility functions.
 */

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useStore, useMapStore } from '@/lib/store';
import { config } from '@/lib/config';
import type { DistanceUnit, TrailDirection, UnitSystem } from '@/lib/types';
import { RulerRange } from '@/lib/distance-utils';
import { PROVIDER_TO_KEY, KEY_TO_PROVIDER } from '@/components/map/base-map-options';
import { BaseMapProvider } from '@/lib/services/map-service';
import { SHARE_QUERY_PARAM_KEYS } from '@/lib/share-url-constants';

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

/**
 * Returns true when the URL is an absolute http(s) URL. Used to gate anchors whose
 * href comes from external data (notices feed, HGSS dataset) so a malicious
 * javascript:/data: payload cannot execute via the link. Relative paths and
 * non-http(s) schemes are rejected.
 */
export function isSafeUrl(u: string | undefined | null): boolean {
	if (!u) return false;
	try {
		const protocol = new URL(u).protocol;
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * Escape a string for safe interpolation into a RegExp source. Use before
 * `new RegExp(...)` whenever the pattern is built from a value that could be
 * influenced by external input.
 */
export function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/** Factor for km → mi (1 km = 0.621371 mi). */
const KM_TO_MI = 0.621371;

/** Convert kilometers to miles. */
export function kmToMiles(km: number): number {
	return km * KM_TO_MI;
}

/** Format a distance-from-trail value (in km) for display in POI list/search
 *  rows. Returns a string with one decimal place in the active unit. */
export function formatOffTrail(km: number, units: UnitSystem): string {
	const v = units === 'imperial' ? kmToMiles(km) : km;
	const unit = units === 'imperial' ? 'mi' : 'km';
	return `${(Math.round(v * 10) / 10).toFixed(1)} ${unit}`;
}

const toImperial: Conversions = {
	distance: kmToMiles,
	elevation: (meters: number): number => meters * 3.28084,
};

/** Convert miles to kilometers. */
export function milesToKm(mi: number): number {
	return mi / KM_TO_MI;
}

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
	// Defence-in-depth: clamp to finite numbers before interpolating into URIs.
	if (
		!Number.isFinite(originLat) ||
		!Number.isFinite(originLng) ||
		!Number.isFinite(destLat) ||
		!Number.isFinite(destLng)
	) {
		return '';
	}
	if (isMobile()) {
		return `geo:${destLat},${destLng}`;
	}
	return `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}`;
}

/**
 * Open a map app at the given coordinates (no directions, just the point).
 * On mobile: opens the device's default maps app via `geo:` URI (Apple Maps,
 *   Google Maps, OsmAnd, Organic Maps, whatever the user has set as default).
 * On desktop: opens Google Maps in a new tab.
 *
 * Shared between the trail click tooltip and the POI popup so both surfaces
 * use the same "view this point externally" affordance.
 *
 * @param lat Latitude
 * @param lng Longitude
 */
export function openCoordinatesInMaps(lat: number, lng: number): void {
	if (typeof window === 'undefined') return;
	// Defence-in-depth: clamp to finite numbers before interpolating into URIs.
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
	if (isMobile()) {
		window.location.href = `geo:${lat},${lng}?q=${lat},${lng}`;
	} else {
		window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank', 'noopener,noreferrer');
	}
}

/** Short keys for base map used in share URLs (e.g. standard, topo, croatiaTopo, darkMap) */
export type ShareBaseMapKey =
	| 'standard'
	| 'topo'
	| 'satellite'
	| 'terrain'
	| 'cycling'
	| 'openHikingMap'
	| 'croatiaTopo'
	| 'darkMap';

/** Mutually exclusive trail rendering modes encoded in share URLs. */
export type ShareTrailStyle = 'default' | 'sections' | 'grade' | 'surface' | 'sac';

/** Map style and layer flags shared across view, progress, and POI links. */
export interface ShareMapStyleParams {
	direction?: TrailDirection;
	unit?: DistanceUnit;
	baseMap?: ShareBaseMapKey;
	trailStyle?: ShareTrailStyle;
	/** Legacy share links used `sections=0|1` before `trailStyle` existed. */
	sections?: boolean;
	dark?: boolean;
	rulerRange?: RulerRange | null;
	pois?: boolean;
	weather?: boolean;
	radar?: boolean;
	distanceMarkers?: boolean;
	waymarked?: boolean;
}

export type ShareUrlParams = ShareMapStyleParams & {
	lat?: number;
	lng?: number;
	zoom?: number;
	dir?: TrailDirection;
	progress?: number;
	poi?: string;
};

/** Share URL param keys that we add/remove */
const SHARE_URL_PARAMS = SHARE_QUERY_PARAM_KEYS;

/** POI ids are token-like (alphanumeric, dot, dash, underscore). Anything
 *  else is rejected to avoid the URL becoming an injection vector or
 *  carrying surprising whitespace into selectors. */
const POI_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

const VALID_SHARE_BASE_MAP_KEYS = new Set<ShareBaseMapKey>([
	'standard',
	'topo',
	'satellite',
	'terrain',
	'cycling',
	'openHikingMap',
	'croatiaTopo',
	'darkMap',
]);

const VALID_SHARE_TRAIL_STYLES = new Set<ShareTrailStyle>(['default', 'sections', 'grade', 'surface', 'sac']);

function parseShareFlag(value: string | null): boolean | undefined {
	if (value === null) return undefined;
	return value === '1';
}

function appendShareStyleParams(url: URL, params: ShareMapStyleParams): void {
	if (params.direction) {
		url.searchParams.set('dir', params.direction);
	}
	if (params.unit) {
		url.searchParams.set('unit', params.unit);
	}
	if (params.baseMap) {
		url.searchParams.set('baseMap', params.baseMap);
	}
	if (params.trailStyle) {
		url.searchParams.set('trailStyle', params.trailStyle);
	}
	if (params.dark !== undefined) {
		url.searchParams.set('dark', params.dark ? '1' : '0');
	}
	if (params.pois !== undefined) {
		url.searchParams.set('pois', params.pois ? '1' : '0');
	}
	if (params.weather !== undefined) {
		url.searchParams.set('weather', params.weather ? '1' : '0');
	}
	if (params.radar !== undefined) {
		url.searchParams.set('radar', params.radar ? '1' : '0');
	}
	if (params.distanceMarkers !== undefined) {
		url.searchParams.set('distanceMarkers', params.distanceMarkers ? '1' : '0');
	}
	if (params.waymarked !== undefined) {
		url.searchParams.set('waymarked', params.waymarked ? '1' : '0');
	}
	if (params.rulerRange) {
		const a = Math.round(params.rulerRange.distanceFromStartA);
		const b = Math.round(params.rulerRange.distanceFromStartB);
		if (Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0) {
			url.searchParams.set('ruler', `${a},${b}`);
		}
	}
}

/** Derive the active trail style from store flags (SAC > surface > grade > sections > default). */
export function resolveShareTrailStyle(state: {
	sacColoured: boolean;
	surfaceColoured: boolean;
	gradeTintedTrail: boolean;
	showSections: boolean;
}): ShareTrailStyle {
	if (state.sacColoured) return 'sac';
	if (state.surfaceColoured) return 'surface';
	if (state.gradeTintedTrail) return 'grade';
	if (state.showSections) return 'sections';
	return 'default';
}

/** Read the current map style/layer toggles from the store for share URL encoding. */
export function collectShareMapStyleParams(options?: {
	rulerEnabled?: boolean;
	rulerRange?: RulerRange | null;
}): ShareMapStyleParams {
	const state = useMapStore.getState();
	const rulerEnabled = options?.rulerEnabled ?? state.isRulerEnabled;
	const baseMapKey = PROVIDER_TO_KEY[state.baseMapProvider as BaseMapProvider] as ShareBaseMapKey | undefined;

	return {
		direction: state.direction,
		unit: state.units === 'imperial' ? 'mi' : 'km',
		baseMap: baseMapKey,
		trailStyle: resolveShareTrailStyle(state),
		dark: state.darkMode,
		pois: state.poisLayerEnabled,
		weather: state.severeWeatherLayer,
		radar: state.showRadarOverlay,
		distanceMarkers: state.showDistanceMarkers,
		waymarked: state.waymarkedTrailsOverlay,
		rulerRange: rulerEnabled ? (options?.rulerRange ?? state.rulerRange) : null,
	};
}

/** Apply a share trail style, clearing the other mutually exclusive modes. */
export function applyShareTrailStyle(trailStyle: ShareTrailStyle): void {
	const store = useMapStore.getState();
	switch (trailStyle) {
		case 'sac':
			store.setSacColoured(true);
			break;
		case 'surface':
			store.setSurfaceColoured(true);
			break;
		case 'grade':
			store.setGradeTintedTrail(true);
			break;
		case 'sections':
			store.setShowSections(true);
			break;
		case 'default':
			store.setShowSections(false);
			store.setGradeTintedTrail(false);
			store.setSurfaceColoured(false);
			store.setSacColoured(false);
			break;
	}
}

/** Apply parsed share style params to the map store (not direction or location). */
export function applyShareMapStyleParams(params: ShareMapStyleParams): void {
	const store = useMapStore.getState();
	if (params.unit) {
		const units: UnitSystem = params.unit === 'mi' ? 'imperial' : 'metric';
		store.setUnits(units);
		useStore.getState().setUnits?.(units);
	}
	if (params.baseMap) {
		const provider = KEY_TO_PROVIDER[params.baseMap];
		if (provider) {
			store.setBaseMapProvider(provider);
		}
	}
	const trailStyle =
		params.trailStyle ?? (params.sections !== undefined ? (params.sections ? 'sections' : 'default') : undefined);
	if (trailStyle !== undefined) {
		applyShareTrailStyle(trailStyle);
	}
	if (params.dark !== undefined) {
		store.setDarkMode(params.dark);
	}
	if (params.pois !== undefined) {
		store.setPoisLayerEnabled(params.pois);
	}
	if (params.weather !== undefined) {
		store.setSevereWeatherLayer(params.weather);
	}
	if (params.radar !== undefined) {
		store.setShowRadarOverlay(params.radar);
	}
	if (params.distanceMarkers !== undefined) {
		store.setShowDistanceMarkers(params.distanceMarkers);
	}
	if (params.waymarked !== undefined) {
		store.setWaymarkedTrailsOverlay(params.waymarked);
	}
}

/** Canonical origin + `/` for share links (locale lives in middleware, not the URL path). */
export function getShareBaseUrl(): string {
	if (typeof window === 'undefined') return '/';
	return `${window.location.origin}/`;
}

/**
 * Build a shareable URL with the current map view (center, zoom, direction, style)
 */
export function buildShareViewUrl(
	baseUrl: string,
	params: ShareMapStyleParams & {
		lat: number;
		lng: number;
		zoom: number;
	},
): string {
	const url = new URL(baseUrl);
	url.searchParams.set('lat', params.lat.toFixed(5));
	url.searchParams.set('lng', params.lng.toFixed(5));
	url.searchParams.set('zoom', String(params.zoom));
	appendShareStyleParams(url, params);
	return url.toString();
}

/**
 * Build a shareable URL with progress (distance from start in km, direction, unit, zoom, style).
 * Total is not needed: we find the point by matching progress (km) to distanceFromStart.
 */
export function buildShareProgressUrl(
	baseUrl: string,
	params: ShareMapStyleParams & {
		kmFromStart: number;
		direction: TrailDirection;
		zoom?: number;
	},
): string {
	const url = new URL(baseUrl);
	url.searchParams.set('progress', params.kmFromStart.toFixed(2));
	url.searchParams.set('dir', params.direction);
	if (params.zoom !== null && params.zoom !== undefined) {
		url.searchParams.set('zoom', String(params.zoom));
	}
	appendShareStyleParams(url, { ...params, direction: params.direction });
	return url.toString();
}

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

/**
 * Parse share URL params from the current location. Returns null if no share-related params are present.
 */
export function parseShareUrlParams(): ShareUrlParams | null {
	if (typeof window === 'undefined') return null;
	const params = new URLSearchParams(window.location.search);
	if (!SHARE_URL_PARAMS.some((key) => params.has(key))) return null;

	const lat = params.get('lat');
	const lng = params.get('lng');
	const zoom = params.get('zoom');
	const dir = params.get('dir');
	const progress = params.get('progress');
	const unit = params.get('unit');
	const baseMap = params.get('baseMap');
	const trailStyle = params.get('trailStyle');
	const sections = params.get('sections');
	const dark = params.get('dark');
	const ruler = params.get('ruler');
	const poi = params.get('poi');

	let rulerRange: RulerRange | undefined;
	if (ruler) {
		const parts = ruler.split(',');
		if (parts.length === 2) {
			const a = parseFloat(parts[0]);
			const b = parseFloat(parts[1]);
			if (Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0) {
				rulerRange = { distanceFromStartA: a, distanceFromStartB: b };
			}
		}
	}

	return {
		...(lat && lng && { lat: parseFloat(lat), lng: parseFloat(lng) }),
		...(zoom && { zoom: parseFloat(zoom) }),
		...(dir && (dir === 'NOBO' || dir === 'SOBO') && { dir }),
		...(progress && { progress: parseFloat(progress) }),
		...(unit && (unit === 'km' || unit === 'mi') && { unit }),
		...(baseMap &&
			VALID_SHARE_BASE_MAP_KEYS.has(baseMap as ShareBaseMapKey) && {
				baseMap: baseMap as ShareBaseMapKey,
			}),
		...(trailStyle &&
			VALID_SHARE_TRAIL_STYLES.has(trailStyle as ShareTrailStyle) && {
				trailStyle: trailStyle as ShareTrailStyle,
			}),
		...(sections !== null && sections !== undefined && { sections: sections === '1' }),
		...(dark !== null && dark !== undefined && { dark: dark === '1' }),
		...(parseShareFlag(params.get('pois')) !== undefined && { pois: parseShareFlag(params.get('pois')) }),
		...(parseShareFlag(params.get('weather')) !== undefined && { weather: parseShareFlag(params.get('weather')) }),
		...(parseShareFlag(params.get('radar')) !== undefined && { radar: parseShareFlag(params.get('radar')) }),
		...(parseShareFlag(params.get('distanceMarkers')) !== undefined && {
			distanceMarkers: parseShareFlag(params.get('distanceMarkers')),
		}),
		...(parseShareFlag(params.get('waymarked')) !== undefined && {
			waymarked: parseShareFlag(params.get('waymarked')),
		}),
		...(rulerRange && { rulerRange }),
		...(poi && POI_ID_RE.test(poi) && { poi }),
	};
}

/** Build a deep-link URL that points to a specific POI by id. The handler
 *  on load uses the id to look up the POI in the dataset, fly the map to its
 *  coordinates, and open its popup. Merges the current map style from the
 *  store so the recipient sees the same layers the sharer had enabled. */
export function buildPoiShareUrl(poiId: string): string {
	if (typeof window === 'undefined') return '';
	const url = new URL(getShareBaseUrl());
	appendShareStyleParams(url, collectShareMapStyleParams());
	url.searchParams.set('poi', poiId);
	return url.toString();
}

/**
 * Check if a geographic point is within the map boundary (Croatia)
 *
 * @param latitude Latitude of the point to check
 * @param longitude Longitude of the point to check
 * @returns Boolean indicating if the point is within the map boundary
 */
export function isWithinMapBoundary(latitude: number, longitude: number): boolean {
	return (
		latitude >= BOUNDARY_LAT_MIN &&
		latitude <= BOUNDARY_LAT_MAX &&
		longitude >= BOUNDARY_LNG_MIN &&
		longitude <= BOUNDARY_LNG_MAX
	);
}
