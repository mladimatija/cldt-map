import type { TrailDirection, UnitSystem } from './types';
import { BaseMapProvider } from './services/base-map-provider';
import { isBaseMapProviderAvailable } from './services/map-service-config';
import { DEFAULT_POI_TYPES } from './poi-types';
import { isUiTextScale, type UiTextScale } from './ui-text-scale';
import { clampPaceFactor } from './pack-weight';

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

// Every helper takes the env VALUE, never the key. Next.js only inlines literal
// `process.env.NEXT_PUBLIC_*` reads into client bundles; a computed
// `process.env[key]` stays a runtime lookup on an empty object in the browser,
// so the override would silently never apply. ESLint flags computed reads in src/.

/** Parse env as boolean: "true" or "1" => true, otherwise defaultVal. */
function envBool(value: string | undefined, defaultVal: boolean): boolean {
	if (value === undefined) {
		return defaultVal;
	}
	return value === 'true' || value === '1';
}

function envInt(value: string | undefined, defaultVal: number): number {
	if (value === undefined || value === '') {
		return defaultVal;
	}
	const n = parseInt(value, 10);
	return Number.isNaN(n) ? defaultVal : n;
}

function envFloat(value: string | undefined, defaultVal: number): number {
	if (value === undefined || value === '') {
		return defaultVal;
	}
	const n = parseFloat(value);
	return Number.isNaN(n) ? defaultVal : n;
}

/** Tri-state boolean env: "true"/"1" => true, "false"/"0" => false, unset => undefined.
 *  Use when callers need to distinguish "not set" from "explicitly false". */
function envBoolOptional(value: string | undefined): boolean | undefined {
	if (value === undefined || value === '') return undefined;
	if (value === 'true' || value === '1') return true;
	if (value === 'false' || value === '0') return false;
	return undefined;
}

function envMapCenter(value: string | undefined, defaultVal: [number, number]): [number, number] {
	if (!value) return defaultVal;
	const parts = value.split(',').map((s) => parseFloat(s.trim()));
	if (parts.length !== 2 || parts.some(Number.isNaN)) return defaultVal;
	return [parts[0], parts[1]];
}

function envBaseMapProvider(value: string | undefined, defaultVal: string): string {
	if (!value || !VALID_BASE_MAP_PROVIDERS.has(value as BaseMapProvider) || !isBaseMapProviderAvailable(value)) {
		return defaultVal;
	}
	return value;
}

function envUiTextScale(value: string | undefined): UiTextScale {
	return isUiTextScale(value) ? value : 'default';
}

/** Default map center (Croatia) and zoom for initial load */
export const mapDefaults = {
	center: envMapCenter(process.env.NEXT_PUBLIC_DEFAULT_MAP_CENTER, [44.4268, 16.438]),
	zoom: envInt(process.env.NEXT_PUBLIC_DEFAULT_MAP_ZOOM, 7),
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
	distancePrecision: envInt(process.env.NEXT_PUBLIC_DEFAULT_DISTANCE_PRECISION, 2),

	/** Show Croatia boundary on an initial load */
	showBoundary: envBool(process.env.NEXT_PUBLIC_SHOW_BOUNDARY, false),

	/** Show boundary-clipped tiles on an initial load */
	showTileBoundary: envBool(process.env.NEXT_PUBLIC_SHOW_TILE_BOUNDARY, true),

	/** Show user location marker by default */
	showUserMarker: envBool(process.env.NEXT_PUBLIC_SHOW_USER_MARKER, true),

	/** Default base map layer */
	baseMapProvider: envBaseMapProvider(process.env.NEXT_PUBLIC_DEFAULT_BASE_MAP, BaseMapProvider.OPEN_STREET_MAP),

	/** Dark mode by default */
	darkMode: envBool(process.env.NEXT_PUBLIC_DEFAULT_DARK_MODE, false),

	/** Battery saver mode by default */
	batterySaverMode: envBool(process.env.NEXT_PUBLIC_DEFAULT_BATTERY_SAVER, false),

	/** Large touch targets by default (accessibility) */
	largeTouchTargets: envBool(process.env.NEXT_PUBLIC_DEFAULT_LARGE_TOUCH_TARGETS, false),

	/** UI text size (accessibility): default | large | larger */
	uiTextScale: envUiTextScale(process.env.NEXT_PUBLIC_DEFAULT_UI_TEXT_SCALE),

	/** Distance ruler enabled by default */
	rulerEnabled: envBool(process.env.NEXT_PUBLIC_DEFAULT_RULER_ENABLED, false),

	/** Show trail sections (color-coded segments and boundary markers) by default */
	showSections: envBool(process.env.NEXT_PUBLIC_DEFAULT_SHOW_SECTIONS, false),

	/** Grade-tinted trail rendering by default (mutually exclusive with showSections, surfaceColoured, sacColoured). */
	gradeTintedTrail: envBool(process.env.NEXT_PUBLIC_DEFAULT_GRADE_TINTED_TRAIL, false),

	/** Surface-coloured trail rendering by default (mutually exclusive with the other trail styles). */
	surfaceColoured: envBool(process.env.NEXT_PUBLIC_DEFAULT_SURFACE_COLOURED, false),

	/** SAC-difficulty-coloured trail rendering by default (mutually exclusive with the other trail styles). */
	sacColoured: envBool(process.env.NEXT_PUBLIC_DEFAULT_SAC_COLOURED, false),

	/** Show zoom-aware distance markers along the trail by default. */
	showDistanceMarkers: envBool(process.env.NEXT_PUBLIC_DEFAULT_DISTANCE_MARKERS, false),

	/** POI map layer master toggle default. Off-by-default so first-time users
	 *  see the trail unobstructed; the panel shows a confirmation dialog the
	 *  first time they enable it (POIs are publicly sourced, not LDTH-vetted). */
	poisLayerEnabled: envBool(process.env.NEXT_PUBLIC_DEFAULT_POIS_ENABLED, false),

	/** Walking pace in km/h used for passage-time estimates. */
	walkingPaceKmh: envFloat(process.env.NEXT_PUBLIC_DEFAULT_WALKING_PACE_KMH, 4),

	/** Personal pace adjustment factor (1 = no change, >1 = faster, <1 = slower).
	 *  Scales every ETA; clamped to the valid range. */
	paceFactor: clampPaceFactor(envFloat(process.env.NEXT_PUBLIC_DEFAULT_PACE_FACTOR, 1)),

	/** Apply Tobler-style grade adjustment to ETA estimates by default. */
	gradeAdjustedEta: envBool(process.env.NEXT_PUBLIC_DEFAULT_GRADE_ADJUSTED_ETA, true),

	/** Show sunset projection on the trail by default. */
	sunsetProjection: envBool(process.env.NEXT_PUBLIC_DEFAULT_SUNSET_PROJECTION, false),

	/** Show severe-weather overlay by default. */
	severeWeatherLayer: envBool(process.env.NEXT_PUBLIC_DEFAULT_SEVERE_WEATHER_LAYER, false),

	/** Use compact share links (`/s/{code}`) by default. */
	shareShortLinks: envBool(process.env.NEXT_PUBLIC_DEFAULT_SHARE_SHORT_LINKS, true),

	/** Show POIs the enricher marked unreachable (`isReachable === false`). */
	includeRemotePois: envBool(process.env.NEXT_PUBLIC_DEFAULT_INCLUDE_REMOTE_POIS, false),

	/** Show mine-suspected areas by default. ON: this is a life-safety layer,
	 *  so users opt out rather than in. */
	mineAreasEnabled: envBool(process.env.NEXT_PUBLIC_DEFAULT_MINE_AREAS, true),

	/** Show the marked-trail junction data-book layer by default. OFF: the layer
	 *  stays hidden until a maintainer runs `npm run enrich-junctions` and commits
	 *  real data (the bundled dataset ships empty). */
	showTrailJunctions: envBool(process.env.NEXT_PUBLIC_DEFAULT_TRAIL_JUNCTIONS, false),

	/** Auto-sync tile cache in the background by default. */
	autoSync: envBool(process.env.NEXT_PUBLIC_DEFAULT_AUTO_SYNC, false),

	/** Predictively pre-cache tiles near the user's position by default. */
	predictivePrecache: envBool(process.env.NEXT_PUBLIC_DEFAULT_PREDICTIVE_PRECACHE, false),

	/** Curator email for the POI "Report an issue" link. Empty (default) hides
	 *  the link; when set, popups offer a prefilled, account-free mailto so a
	 *  hiker can flag a wrong/closed/dry place. Trimmed here; final anti-injection
	 *  shape validation happens at the point of use in `buildReportLinkHtml`.
	 *  Never sent automatically (the user sends from their own mail client). */
	curatorReportEmail: (process.env.NEXT_PUBLIC_CURATOR_REPORT_EMAIL ?? '').trim(),
} as const;

/** Number of days after which a tile cache is considered stale (overridable via env). */
export const tileCacheTtlDays = envInt(process.env.NEXT_PUBLIC_TILE_CACHE_TTL_DAYS, 30);

/** Tri-state override for the seasonal-status layer default. `undefined` means
 *  fall back to the winter-window auto-default (Nov 1 - May 31). Setting the
 *  env to "true" or "false" overrides the auto-default unconditionally. */
export const seasonalStatusLayerEnabledOverride = envBoolOptional(
	process.env.NEXT_PUBLIC_DEFAULT_SEASONAL_STATUS_ENABLED,
);

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
