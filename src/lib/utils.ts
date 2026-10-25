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
import { toTravelRange } from '@/lib/trail-frame';
import {
	PROVIDER_TO_KEY,
	KEY_TO_PROVIDER,
	isShareBaseMapKey,
	type ShareBaseMapKey,
} from '@/components/map/base-map-options';
import { BaseMapProvider } from '@/lib/services/map-service';
import { siteMetadata } from '@/lib/metadata';
import { SHARE_QUERY_PARAM_KEYS, SHARE_TRIP_PARAM_KEY } from '@/lib/share-url-constants';
import {
	appendShareTripStateToUrl,
	parseShareTripStateParam,
	type ShareTripStatePayload,
} from '@/lib/share-trip-state';
import { POI_ID_RE } from '@/lib/poi-types';
import { CROATIA_BBOX, isInCroatiaBbox } from '@/lib/geo-bounds';
import { formatKm, metresToFeet } from '@/lib/units';

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
export function isSafeUrl(u: string | undefined | null): u is string {
	if (!u) return false;
	try {
		const protocol = new URL(u).protocol;
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

/** Phone shapes safe to turn into a tel:/sms: link (mirrors the POI popup / HGSS guard). */
export const LINKABLE_PHONE_RE = /^\+?[\d\s().,-]{1,30}$/;

/**
 * Reduce a (LINKABLE_PHONE_RE-valid) phone to a tel:/sms: dial string: digits with
 * at most a single leading '+'. Drops formatting characters that could otherwise
 * inject extra sms: URI parameters, and collapses stray inner '+' signs.
 */
export function toDialString(phone: string): string {
	const cleaned = phone.replace(/[^\d+]/g, '');
	const digits = cleaned.replace(/\+/g, '');
	return cleaned.startsWith('+') ? `+${digits}` : digits;
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
 * Shape used by store for locationError.
 */
export function toLocationError(error: unknown, fallbackMessage: string): { code: number; message: string } {
	return {
		code: 0,
		message: error instanceof Error ? error.message : fallbackMessage,
	};
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
	units: UnitSystem,
	precision?: number,
	needsConversion: boolean = false,
): string {
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

	return formatKm(needsConversion ? distance / 1000 : distance, units, precision);
}

/**
 * Format elevation with appropriate units
 *
 * @param elevation Elevation in meters
 * @param units Unit system to use (metric or imperial)
 * @param precision Number of decimal places for formatted output
 * @returns Formatted elevation string with units
 */
export function formatElevation(elevation: number, units: UnitSystem, precision: number = 0): string {
	return units === 'imperial'
		? `${metresToFeet(elevation).toFixed(precision)} ft`
		: `${elevation.toFixed(precision)} m`;
}

/**
 * Generate a random point within the map boundary (Croatia)
 * Used for dev-mode fake user location.
 *
 * @returns Location object with lat, lng
 */
export function getRandomLocationInBoundary(): { lat: number; lng: number } {
	const lat = CROATIA_BBOX.latMin + Math.random() * (CROATIA_BBOX.latMax - CROATIA_BBOX.latMin);
	const lng = CROATIA_BBOX.lngMin + Math.random() * (CROATIA_BBOX.lngMax - CROATIA_BBOX.lngMin);
	return { lat, lng };
}

/**
 * Detect if the user is on a mobile device (phone or tablet).
 * Combines the UA regex with a coarse-pointer + touch heuristic so modern
 * tablets that omit the legacy UA tokens are still treated as mobile.
 */
export function isMobile(): boolean {
	if (typeof navigator === 'undefined') return false;
	if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
		return true;
	}
	if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
		const coarse = window.matchMedia('(pointer: coarse)').matches;
		if (coarse && (navigator.maxTouchPoints ?? 0) > 0) return true;
	}
	return false;
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

export type { ShareBaseMapKey };

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
	wp?: string;
	tripState?: ShareTripStatePayload;
};

/** True when map/POI handlers still need to read positional or deep-link params from the URL. */
export function shareParamsNeedMapFollowUp(params: ShareUrlParams): boolean {
	if (params.poi) return true;
	if (params.wp) return true;
	if (params.progress !== undefined) return true;
	if (params.lat !== undefined && params.lng !== undefined) return true;
	if (params.rulerRange) return true;
	return false;
}

/** Skip the default trail fitBounds on load when a share link will fly elsewhere.
 *  Every follow-up except the ruler moves the view away from the whole trail. */
export function shareParamsSkipInitialTrailFitBounds(params: ShareUrlParams | null): boolean {
	return !!params && shareParamsNeedMapFollowUp({ ...params, rulerRange: undefined });
}

/** Share URL param keys that we add/remove */
const SHARE_URL_PARAMS = SHARE_QUERY_PARAM_KEYS;

/** Params captured once on first read so handlers keep working after the URL is cleaned. */
let initialShareUrlParams: ShareUrlParams | null | undefined;

/** Read share params from the landing URL once (e.g. after a `/s/{code}` redirect). */
export function getInitialShareUrlParams(): ShareUrlParams | null {
	if (typeof window === 'undefined') return null;
	if (initialShareUrlParams === undefined) {
		initialShareUrlParams = parseShareUrlParams();
	}
	return initialShareUrlParams;
}

const VALID_SHARE_TRAIL_STYLES = new Set<ShareTrailStyle>(['default', 'sections', 'grade', 'surface', 'sac']);

function parseShareFlag(value: string | null): boolean | undefined {
	if (value === null) return undefined;
	return value === '1';
}

/** On/off layer flags carried by share links (`1` on, anything else off). */
const SHARE_FLAG_KEYS = ['pois', 'weather', 'radar', 'distanceMarkers', 'waymarked'] as const;

/** Share-link view bounds: Croatia plus a margin, so a view panned slightly off
 *  the coast or across a border still opens. Anything else is a broken link. */
const SHARE_VIEW_BOUNDS = { latMin: 41.5, latMax: 47, lngMin: 12.5, lngMax: 20.5 };
const SHARE_ZOOM_MIN = 0;
const SHARE_ZOOM_MAX = 20;
/** Upper bound for trail distances in share links (the trail is ~2,220 km). */
const SHARE_MAX_TRAIL_KM = 5000;

/** Strict number parse ("45abc" is rejected, unlike parseFloat) within [min, max]. */
function parseShareNumber(value: string | null, min: number, max: number): number | undefined {
	if (value === null || value.trim() === '') return undefined;
	const n = Number(value);
	return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
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
	// The store holds a plain string (persisted); an unknown provider has no key.
	const baseMapKey: ShareBaseMapKey | undefined = PROVIDER_TO_KEY[state.baseMapProvider as BaseMapProvider];
	// The store keeps the ruler in SOBO metres; links carry it in travel metres
	// under `dir`, as links have always done, so older and newer links read alike.
	const soboRuler = rulerEnabled ? (options?.rulerRange ?? state.rulerRange) : null;
	const totalM = (useStore.getState().trailMetadata?.totalDistance ?? 0) * 1000;
	const travelRuler = soboRuler
		? toTravelRange(soboRuler.distanceFromStartA, soboRuler.distanceFromStartB, state.direction, totalM)
		: null;

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
		rulerRange: travelRuler ? { distanceFromStartA: travelRuler.from, distanceFromStartB: travelRuler.to } : null,
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
		store.setUnits(params.unit === 'mi' ? 'imperial' : 'metric');
	}
	if (params.baseMap) {
		store.setBaseMapProvider(KEY_TO_PROVIDER[params.baseMap]);
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
	const { hostname } = window.location;
	const origin =
		hostname === 'localhost' || hostname === '127.0.0.1' ? window.location.origin : siteMetadata.url.replace(/\/$/, '');
	return `${origin}/`;
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
	const wp = params.get('wp');
	const tripState = parseShareTripStateParam(params.get(SHARE_TRIP_PARAM_KEY));

	// Ruler ends are metres from the trail start.
	let rulerRange: RulerRange | undefined;
	if (ruler) {
		const parts = ruler.split(',');
		if (parts.length === 2) {
			const a = parseShareNumber(parts[0], 0, SHARE_MAX_TRAIL_KM * 1000);
			const b = parseShareNumber(parts[1], 0, SHARE_MAX_TRAIL_KM * 1000);
			if (a !== undefined && b !== undefined) {
				rulerRange = { distanceFromStartA: a, distanceFromStartB: b };
			}
		}
	}

	// A coordinate pair counts only when BOTH parts are valid.
	const latValue = parseShareNumber(lat, SHARE_VIEW_BOUNDS.latMin, SHARE_VIEW_BOUNDS.latMax);
	const lngValue = parseShareNumber(lng, SHARE_VIEW_BOUNDS.lngMin, SHARE_VIEW_BOUNDS.lngMax);
	const zoomValue = parseShareNumber(zoom, SHARE_ZOOM_MIN, SHARE_ZOOM_MAX);
	const progressValue = parseShareNumber(progress, 0, SHARE_MAX_TRAIL_KM);

	const flags: Partial<Record<(typeof SHARE_FLAG_KEYS)[number], boolean>> = {};
	for (const key of SHARE_FLAG_KEYS) {
		const value = parseShareFlag(params.get(key));
		if (value !== undefined) flags[key] = value;
	}

	return {
		...(latValue !== undefined && lngValue !== undefined && { lat: latValue, lng: lngValue }),
		...(zoomValue !== undefined && { zoom: zoomValue }),
		...(dir && (dir === 'NOBO' || dir === 'SOBO') && { dir }),
		...(progressValue !== undefined && { progress: progressValue }),
		...(unit && (unit === 'km' || unit === 'mi') && { unit }),
		...(baseMap && isShareBaseMapKey(baseMap) && { baseMap }),
		...(trailStyle &&
			VALID_SHARE_TRAIL_STYLES.has(trailStyle as ShareTrailStyle) && {
				trailStyle: trailStyle as ShareTrailStyle,
			}),
		...(sections !== null && sections !== undefined && { sections: sections === '1' }),
		...(dark !== null && dark !== undefined && { dark: dark === '1' }),
		...flags,
		...(rulerRange && { rulerRange }),
		...(poi && POI_ID_RE.test(poi) && { poi }),
		...(wp && POI_ID_RE.test(wp) && { wp }),
		...(tripState && { tripState }),
	};
}

/** Build a deep-link URL that points to a specific POI by id. The handler
 *  on load uses the id to look up the POI in the dataset, fly the map to its
 *  coordinates, and open its popup. Merges the current map style from the
 *  store so the recipient sees the same layers the sharer had enabled. Never
 *  carries trip data: the POI is public, the sender's plan and notes are not. */
export function buildPoiShareUrl(poiId: string): string {
	if (typeof window === 'undefined') return '';
	const url = new URL(getShareBaseUrl());
	appendShareStyleParams(url, collectShareMapStyleParams());
	// Recipients must see POI markers for the deep link to open the popup.
	url.searchParams.set('pois', '1');
	url.searchParams.set('poi', poiId);
	return url.toString();
}

/** Build a deep-link URL that points to a personal waypoint by id. Only that
 *  waypoint rides along in the `trip` param, so recipients can add it and open
 *  its popup; the rest of the sender's trip data stays private. */
export function buildWaypointShareUrl(waypointId: string): string {
	if (typeof window === 'undefined') return '';
	const url = new URL(getShareBaseUrl());
	appendShareStyleParams(url, collectShareMapStyleParams());
	url.searchParams.set('wp', waypointId);
	appendShareTripStateToUrl(url, { waypoints: true, waypointIds: [waypointId] });
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
	return isInCroatiaBbox(latitude, longitude);
}
