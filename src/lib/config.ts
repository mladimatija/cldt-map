import type { TrailDirection, UnitSystem } from './types';
import { BaseMapProvider } from './services/base-map-provider';
import { DEFAULT_POI_TYPES } from './poi-types';
import { isUiTextScale, type UiTextScale } from './ui-text-scale';

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

function envFloat(key: string, defaultVal: number): number {
	const v = process.env[key];
	if (v === undefined || v === '') {
		return defaultVal;
	}
	const n = parseFloat(v);
	return Number.isNaN(n) ? defaultVal : n;
}

/** Tri-state boolean env: "true"/"1" => true, "false"/"0" => false, unset => undefined.
 *  Use when callers need to distinguish "not set" from "explicitly false". */
function envBoolOptional(key: string): boolean | undefined {
	const v = process.env[key];
	if (v === undefined || v === '') return undefined;
	if (v === 'true' || v === '1') return true;
	if (v === 'false' || v === '0') return false;
	return undefined;
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

function envUiTextScale(key: string): UiTextScale {
	const v = process.env[key];
	return isUiTextScale(v) ? v : 'default';
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

	/** UI text size (accessibility): default | large | larger */
	uiTextScale: envUiTextScale('NEXT_PUBLIC_DEFAULT_UI_TEXT_SCALE'),

	/** Distance ruler enabled by default */
	rulerEnabled: envBool('NEXT_PUBLIC_DEFAULT_RULER_ENABLED', false),

	/** Show trail sections (color-coded segments and boundary markers) by default */
	showSections: envBool('NEXT_PUBLIC_DEFAULT_SHOW_SECTIONS', false),

	/** Grade-tinted trail rendering by default (mutually exclusive with showSections, surfaceColoured, sacColoured). */
	gradeTintedTrail: envBool('NEXT_PUBLIC_DEFAULT_GRADE_TINTED_TRAIL', false),

	/** Surface-coloured trail rendering by default (mutually exclusive with the other trail styles). */
	surfaceColoured: envBool('NEXT_PUBLIC_DEFAULT_SURFACE_COLOURED', false),

	/** SAC-difficulty-coloured trail rendering by default (mutually exclusive with the other trail styles). */
	sacColoured: envBool('NEXT_PUBLIC_DEFAULT_SAC_COLOURED', false),

	/** Show zoom-aware distance markers along the trail by default. */
	showDistanceMarkers: envBool('NEXT_PUBLIC_DEFAULT_DISTANCE_MARKERS', false),

	/** POI map layer master toggle default. Off-by-default so first-time users
	 *  see the trail unobstructed; the panel shows a confirmation dialog the
	 *  first time they enable it (POIs are publicly sourced, not LDTH-vetted). */
	poisLayerEnabled: envBool('NEXT_PUBLIC_DEFAULT_POIS_ENABLED', false),

	/** Walking pace in km/h used for passage-time estimates. */
	walkingPaceKmh: envFloat('NEXT_PUBLIC_DEFAULT_WALKING_PACE_KMH', 4),

	/** Apply Tobler-style grade adjustment to ETA estimates by default. */
	gradeAdjustedEta: envBool('NEXT_PUBLIC_DEFAULT_GRADE_ADJUSTED_ETA', true),

	/** Show sunset projection on the trail by default. */
	sunsetProjection: envBool('NEXT_PUBLIC_DEFAULT_SUNSET_PROJECTION', false),

	/** Show severe-weather overlay by default. */
	severeWeatherLayer: envBool('NEXT_PUBLIC_DEFAULT_SEVERE_WEATHER_LAYER', false),

	/** Use compact share links (`/s/{code}`) by default. */
	shareShortLinks: envBool('NEXT_PUBLIC_DEFAULT_SHARE_SHORT_LINKS', true),

	/** Show POIs the enricher marked unreachable (`isReachable === false`). */
	includeRemotePois: envBool('NEXT_PUBLIC_DEFAULT_INCLUDE_REMOTE_POIS', false),

	/** Show mine-suspected areas by default. ON: this is a life-safety layer,
	 *  so users opt out rather than in. */
	mineAreasEnabled: envBool('NEXT_PUBLIC_DEFAULT_MINE_AREAS', true),

	/** Auto-sync tile cache in the background by default. */
	autoSync: envBool('NEXT_PUBLIC_DEFAULT_AUTO_SYNC', false),

	/** Predictively pre-cache tiles near the user's position by default. */
	predictivePrecache: envBool('NEXT_PUBLIC_DEFAULT_PREDICTIVE_PRECACHE', false),

	/** Curator email for the POI "Report an issue" link. Empty (default) hides
	 *  the link; when set, popups offer a prefilled, account-free mailto so a
	 *  hiker can flag a wrong/closed/dry place. Trimmed here; final anti-injection
	 *  shape validation happens at the point of use in `buildReportLinkHtml`.
	 *  Never sent automatically (the user sends from their own mail client). */
	curatorReportEmail: (process.env.NEXT_PUBLIC_CURATOR_REPORT_EMAIL ?? '').trim(),
} as const;

/** Number of days after which a tile cache is considered stale (overridable via env). */
export const tileCacheTtlDays = envInt('NEXT_PUBLIC_TILE_CACHE_TTL_DAYS', 30);

/** Tri-state override for the seasonal-status layer default. `undefined` means
 *  fall back to the winter-window auto-default (Nov 1 - May 31). Setting the
 *  env to "true" or "false" overrides the auto-default unconditionally. */
export const seasonalStatusLayerEnabledOverride = envBoolOptional('NEXT_PUBLIC_DEFAULT_SEASONAL_STATUS_ENABLED');

/** Comma-separated list of POI types enabled by default in the per-type
 *  filter, e.g. "town,settlement". Unset defaults to all v1 known types. */
export const defaultEnabledPoiTypes: ReadonlySet<string> = (() => {
	const raw = process.env.NEXT_PUBLIC_DEFAULT_POI_TYPES;
	if (typeof raw !== 'string' || raw.trim().length === 0) {
		return new Set(DEFAULT_POI_TYPES);
	}
	return new Set(
		raw
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s.length > 0),
	);
})();

/** Maximum distance in metres from the nearest trail point at which a user is considered "on trail".
 *  15 m accounts for typical GPS inaccuracy on narrow trails. */
export const TRAIL_OFF_TRAIL_THRESHOLD_M = 15;
