import type { TrailDirection, UnitSystem } from './types';
import { BaseMapProvider } from './services/base-map-provider';

/**
 * Centralized application defaults.
 *
 * All defaults live here. Override via .env.local (gitignored) without committing.
 * See .env.example for available variables.
 *
 * Precedence: persisted user choice (localStorage) > env var > defaults below.
 */

/** Used to validate NEXT_PUBLIC_DEFAULT_BASE_MAP against known providers. */
const VALID_BASE_MAP_PROVIDERS = new Set(Object.values(BaseMapProvider));

/** Parse env as boolean: "true" or "1" => true, otherwise defaultVal. */
function envBool(key: string, defaultVal: boolean): boolean {
	if (typeof process.env[key] === 'undefined') {
		return defaultVal;
	}
	return process.env[key] === 'true' || process.env[key] === '1';
}

function envInt(key: string, defaultVal: number): number {
	const v = process.env[key];
	if (v === undefined || v === '') {
		return defaultVal;
	}
	const n = parseInt(v, 10);
	return Number.isNaN(n) ? defaultVal : n;
}

function envMapCenter(key: string, defaultVal: [number, number]): [number, number] {
	const v = process.env[key];
	if (!v || typeof v !== 'string') return defaultVal;
	const parts = v.split(',').map((s) => parseFloat(s.trim()));
	if (parts.length !== 2 || parts.some(Number.isNaN)) return defaultVal;
	return [parts[0], parts[1]];
}

function envBaseMapProvider(key: string, defaultVal: string): string {
	const v = process.env[key];
	if (!v || !VALID_BASE_MAP_PROVIDERS.has(v as BaseMapProvider)) return defaultVal;
	return v;
}

/** Default map center (Croatia) and zoom for initial load */
export const mapDefaults = {
	center: envMapCenter('NEXT_PUBLIC_DEFAULT_MAP_CENTER', [44.4268, 16.438]),
	zoom: envInt('NEXT_PUBLIC_DEFAULT_MAP_ZOOM', 7),
} as const;

/** OSM tile URL for the default map view (for LCP preload in document head). Uses Web Mercator tile indexing. */
export function getDefaultMapTileUrl(): string {
	const [lat, lng] = mapDefaults.center;
	const z = mapDefaults.zoom;
	const n = 2 ** z;
	const x = Math.floor(((lng + 180) / 360) * n);
	const latRad = (lat * Math.PI) / 180;
	const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
	return `https://a.tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

/** Map / UI defaults (overridable via .env.local) */
export const config = {
	/** Default trail direction */
	direction: (process.env.NEXT_PUBLIC_DEFAULT_DIRECTION as TrailDirection) || 'SOBO',

	/** Default unit system */
	units: (process.env.NEXT_PUBLIC_DEFAULT_UNITS as UnitSystem) || 'metric',

	/** Default decimal places for distance display */
	distancePrecision: envInt('NEXT_PUBLIC_DEFAULT_DISTANCE_PRECISION', 2),

	/** Show Croatia boundary on an initial load */
	showBoundary: envBool('NEXT_PUBLIC_SHOW_BOUNDARY', false),

	/** Show boundary-clipped tiles on an initial load */
	showTileBoundary: envBool('NEXT_PUBLIC_SHOW_TILE_BOUNDARY', false),

	/** Show user location marker by default */
	showUserMarker: envBool('NEXT_PUBLIC_SHOW_USER_MARKER', true),

	/** Default base map layer */
	baseMapProvider: envBaseMapProvider('NEXT_PUBLIC_DEFAULT_BASE_MAP', BaseMapProvider.OPEN_STREET_MAP),

	/** Dark mode by default */
	darkMode: envBool('NEXT_PUBLIC_DEFAULT_DARK_MODE', false),

	/** Battery saver mode by default */
	batterySaverMode: envBool('NEXT_PUBLIC_DEFAULT_BATTERY_SAVER', false),

	/** Large touch targets by default (accessibility) */
	largeTouchTargets: envBool('NEXT_PUBLIC_DEFAULT_LARGE_TOUCH_TARGETS', false),

	/** Distance ruler enabled by default */
	rulerEnabled: envBool('NEXT_PUBLIC_DEFAULT_RULER_ENABLED', false),

	/** Show trail sections (color-coded segments and boundary markers) by default */
	showSections: envBool('NEXT_PUBLIC_DEFAULT_SHOW_SECTIONS', false),
} as const;

/** Maximum distance in metres from the nearest trail point at which a user is considered "on trail".
 *  15 m accounts for typical GPS inaccuracy on narrow trails. */
export const TRAIL_OFF_TRAIL_THRESHOLD_M = 15;
