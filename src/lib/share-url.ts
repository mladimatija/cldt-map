/**
 * Share links: build view, progress, POI and waypoint URLs from the stores, and
 * parse and apply the params a link carries.
 */
import { useStore, useMapStore } from '@/lib/store';
import type { DistanceUnit, TrailDirection } from '@/lib/types';
import type { RulerRange } from '@/lib/distance-utils';
import { toTravelRange } from '@/lib/trail-frame';
import {
	PROVIDER_TO_KEY,
	KEY_TO_PROVIDER,
	isShareBaseMapKey,
	type ShareBaseMapKey,
} from '@/components/map/base-map-options';
import type { BaseMapProvider } from '@/lib/services/base-map-provider';
import { siteMetadata } from '@/lib/metadata';
import { SHARE_QUERY_PARAM_KEYS, SHARE_TRIP_PARAM_KEY } from '@/lib/share-url-constants';
import {
	appendShareTripStateToUrl,
	parseShareTripStateParam,
	type ShareTripStatePayload,
} from '@/lib/share-trip-state';
import { POI_ID_RE } from '@/lib/poi-types';

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
function resolveShareTrailStyle(state: {
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
function applyShareTrailStyle(trailStyle: ShareTrailStyle): void {
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
function parseShareUrlParams(): ShareUrlParams | null {
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
