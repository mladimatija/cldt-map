/**
 * Tile cache utilities for offline map support.
 *
 * Responsibilities:
 * - Generate tile URLs for the trail corridor (segmented bounding-box approach)
 * - Drive the pre-cache fetch loop that the Service Worker intercepts
 * - Read/write cache metadata from localforage
 * - Query Cache Storage for tile counts and clear caches
 * - Estimate available storage before a download
 *
 * POI prefetch orchestration deliberately lives in the store: both
 * the manual `startTileDownload` flow and the predictive flow trigger the
 * POI asset prefetch from inside `createMapStore` actions, using helpers
 * from `@/lib/poi-prefetch`. This module returns the predictive corridor
 * slice as part of its result so the store action can fire the prefetch
 * itself without tile-cache.ts taking on a POI dependency.
 */
import localforage from 'localforage';
import { DEFAULT_MAP_SERVICES } from '@/lib/services/map-service-config';
import { tileCacheTtlDays } from '@/lib/config';
import { findNearestPointIndex } from '@/lib/distance-utils';
import type { EnhancedTrailPoint, TrailDirection } from '@/lib/store/types';

// ── Constants ─────────────────────────────────────────────────────────────────

export const TILE_CACHE_TTL_MS = tileCacheTtlDays * 24 * 60 * 60 * 1000;
export const PRECACHE_ZOOM_MIN = 8;
export const PRECACHE_ZOOM_MAX = 14;
export const PRECACHE_ZOOM_MAX_HIGH = 15;
/** Look-ahead distance (km) for the optional high-detail ahead pack. */
export const HIGH_DETAIL_AHEAD_KM = 50;
const SEGMENT_DISTANCE_M = 50_000; // 50 km between segment boundaries
const CORRIDOR_PADDING_DEG = 0.02; // ~2 km buffer around each segment
const PRECACHE_BATCH_SIZE = 8; // concurrent fetches
const TILE_CACHE_PREFIX = 'cldt-tiles-';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TileCacheMeta {
	cachedAt: number;
	tileCount: number;
	zoomMin: number;
	zoomMax: number;
	providerKey: string;
	/** Set when zoom-15 ahead tiles were downloaded on top of the baseline corridor. */
	hasHighDetailAhead?: boolean;
}

export interface PrecacheResult {
	done: number;
	total: number;
	cancelled: boolean;
}

export interface StorageEstimate {
	available: boolean;
	usedPercent: number;
	freeBytes: number;
}

// ── Provider mapping ──────────────────────────────────────────────────────────

/** Maps BaseMapProvider name → SW cache key. */
export const PROVIDER_CACHE_KEY: Record<string, string> = {
	OpenStreetMap: 'osm',
	OpenTopoMap: 'topo',
	Satellite: 'esri',
	Terrain: 'esri',
	CyclOSM: 'cyclosm',
	CroatiaTopo: 'dgu',
	OpenHikingMap: 'ohm',
	Dark: 'carto',
};

/** Returns the URL template for a provider name, or null if not found. */
export function getTileUrlTemplate(providerName: string): string | null {
	const service = DEFAULT_MAP_SERVICES.find((s) => s.name === providerName);
	return service?.url ?? null;
}

/** Returns the per-provider cache key for a provider name. */
export function getProviderCacheKey(providerName: string): string {
	return PROVIDER_CACHE_KEY[providerName] ?? 'other';
}

/**
 * Returns true when the provider uses a stable z/x/y tile URL that can be
 * pre-fetched. WMS (DGU) is excluded because tile URLs include dynamic params.
 */
/** Providers whose tile usage policy forbids bulk download / prefetch
 *  (openmaps.fr) or whose terms are restrictive (DGU). They still render
 *  live but are excluded from the offline pre-cache. */
const NON_PRECACHEABLE_PROVIDERS = new Set(['CroatiaTopo', 'OpenHikingMap']);

export function isProviderCacheable(providerName: string): boolean {
	return providerName in PROVIDER_CACHE_KEY && !NON_PRECACHEABLE_PROVIDERS.has(providerName);
}

// ── Tile math ─────────────────────────────────────────────────────────────────

function lonToTileX(lon: number, zoom: number): number {
	return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function latToTileY(lat: number, zoom: number): number {
	const latRad = (lat * Math.PI) / 180;
	return Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom);
}

function buildTileUrl(template: string, z: number, x: number, y: number): string {
	return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)).replace(/{s}/g, 'a'); // use subdomain 'a' for pre-caching
}

/** Croatia bounding box - mirror of CROATIA_BBOX in public/sw.js. Used as a
 *  defence-in-depth clip so the pre-cache never emits tiles outside Croatia,
 *  even if the corridor math ever drifts. The Service Worker applies the
 *  authoritative bbox + polygon clip on the cache-write path. */
const CROATIA_BBOX = { latMin: 42.3, latMax: 46.56, lngMin: 13.2, lngMax: 19.45 };

/** Web-Mercator tile (z/x/y) to its lat/lng bounds. */
function tileLatLngBounds(z: number, x: number, y: number): { lngW: number; lngE: number; latN: number; latS: number } {
	const n = 2 ** z;
	const lngW = (x / n) * 360 - 180;
	const lngE = ((x + 1) / n) * 360 - 180;
	const latN = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
	const latS = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
	return { lngW, lngE, latN, latS };
}

function tileIntersectsCroatia(z: number, x: number, y: number): boolean {
	const b = tileLatLngBounds(z, x, y);
	return (
		b.lngE >= CROATIA_BBOX.lngMin &&
		b.lngW <= CROATIA_BBOX.lngMax &&
		b.latN >= CROATIA_BBOX.latMin &&
		b.latS <= CROATIA_BBOX.latMax
	);
}

function tilesForBounds(
	minLat: number,
	maxLat: number,
	minLon: number,
	maxLon: number,
	zoom: number,
	template: string,
): string[] {
	const xMin = lonToTileX(minLon, zoom);
	const xMax = lonToTileX(maxLon, zoom);
	const yMin = latToTileY(maxLat, zoom); // lat and tile-Y are inverted
	const yMax = latToTileY(minLat, zoom);
	const tiles: string[] = [];
	for (let x = xMin; x <= xMax; x++) {
		for (let y = yMin; y <= yMax; y++) {
			if (!tileIntersectsCroatia(zoom, x, y)) continue; // never pre-cache outside Croatia
			tiles.push(buildTileUrl(template, zoom, x, y));
		}
	}
	return tiles;
}

// ── Corridor computation ──────────────────────────────────────────────────────

interface Bounds {
	minLat: number;
	maxLat: number;
	minLon: number;
	maxLon: number;
}

function computeTrailCorridor(points: Pick<EnhancedTrailPoint, 'lat' | 'lng' | 'distanceFromStart'>[]): Bounds[] {
	const segments: Bounds[] = [];
	let segmentBaseDistance = 0;
	// Running min/max tracked per point (O(1) per point) instead of
	// Math.min(...arr)/Math.max(...arr) spread calls (O(N) per flush, and
	// potentially stack-overflowing on high-density trails with >65k points).
	let segMinLat = Infinity;
	let segMaxLat = -Infinity;
	let segMinLon = Infinity;
	let segMaxLon = -Infinity;

	const flushSegment = (): void => {
		segments.push({
			minLat: segMinLat - CORRIDOR_PADDING_DEG,
			maxLat: segMaxLat + CORRIDOR_PADDING_DEG,
			minLon: segMinLon - CORRIDOR_PADDING_DEG,
			maxLon: segMaxLon + CORRIDOR_PADDING_DEG,
		});
	};

	const resetBounds = (lat: number, lng: number): void => {
		segMinLat = lat;
		segMaxLat = lat;
		segMinLon = lng;
		segMaxLon = lng;
	};

	for (const pt of points) {
		if (pt.lat < segMinLat) segMinLat = pt.lat;
		if (pt.lat > segMaxLat) segMaxLat = pt.lat;
		if (pt.lng < segMinLon) segMinLon = pt.lng;
		if (pt.lng > segMaxLon) segMaxLon = pt.lng;

		if (pt.distanceFromStart - segmentBaseDistance >= SEGMENT_DISTANCE_M) {
			flushSegment();
			segmentBaseDistance = pt.distanceFromStart;
			resetBounds(pt.lat, pt.lng);
		}
	}

	if (segMinLat !== Infinity) {
		flushSegment();
	}

	return segments;
}

/**
 * Generates the full set of tile URLs covering the trail corridor.
 * Trail points are grouped into ~50 km segments; each segment gets a
 * bounding box with ~2 km padding; tiles are generated per zoom level and
 * deduplicated via Set.
 */
export function generateTrailTileUrls(
	points: Pick<EnhancedTrailPoint, 'lat' | 'lng' | 'distanceFromStart'>[],
	urlTemplate: string,
	zoomMin = PRECACHE_ZOOM_MIN,
	zoomMax = PRECACHE_ZOOM_MAX,
): string[] {
	const segments = computeTrailCorridor(points);
	const urlSet = new Set<string>();

	for (const seg of segments) {
		for (let zoom = zoomMin; zoom <= zoomMax; zoom++) {
			for (const url of tilesForBounds(seg.minLat, seg.maxLat, seg.minLon, seg.maxLon, zoom, urlTemplate)) {
				urlSet.add(url);
			}
		}
	}

	return [...urlSet];
}

// ── Pre-caching ───────────────────────────────────────────────────────────────

/**
 * Fetches tile URLs in batches so the Service Worker can intercept and cache
 * each response. The SW's existing tile handler caches automatically -
 * no postMessage coordination needed.
 *
 * Uses `mode:'no-cors'` to match how Leaflet loads tiles via <img src>.
 * Reports progress via the onProgress callback after each batch.
 */
export async function precacheTiles(
	urls: string[],
	onProgress: (done: number, total: number) => void,
	signal: AbortSignal,
): Promise<PrecacheResult> {
	const total = urls.length;
	let done = 0;

	for (let i = 0; i < urls.length; i += PRECACHE_BATCH_SIZE) {
		if (signal.aborted) {
			return { done, total, cancelled: true };
		}

		const batch = urls.slice(i, i + PRECACHE_BATCH_SIZE);

		await Promise.allSettled(batch.map((url) => fetch(url, { mode: 'no-cors', signal }).catch(() => null)));

		done = Math.min(i + PRECACHE_BATCH_SIZE, total);
		onProgress(done, total);
	}

	onProgress(total, total);
	return { done: total, total, cancelled: false };
}

/** Minimal trail-point shape used in ahead slices and predictive precache.
 *  Subset of EnhancedTrailPoint; structurally compatible with the
 *  `CorridorSlicePoint` accepted by poi-prefetch helpers. */
export type PredictivePrecacheSlicePoint = Pick<EnhancedTrailPoint, 'lat' | 'lng' | 'distanceFromStart'>;

// ── Ahead slice ───────────────────────────────────────────────────────────────

/** Default look-ahead distance (km) for the predictive runner. */
const PRECACHE_AHEAD_KM = 20;

export interface AheadTrailSliceArgs {
	points: Pick<EnhancedTrailPoint, 'lat' | 'lng' | 'distanceFromStart'>[];
	fromIdx: number;
	direction: TrailDirection;
	kmAhead?: number;
}

export interface ResolveAheadSliceStartArgs {
	points: Pick<EnhancedTrailPoint, 'lat' | 'lng' | 'distanceFromStart'>[];
	direction: TrailDirection;
	userLocation: { lat: number; lng: number } | null;
	closestPoint: { distance: number; distanceFromStart: number } | null;
	offTrailThresholdM: number;
}

/**
 * Picks the trail index where the ahead slice begins. Uses the on-trail GPS
 * position when available; otherwise the trail start in the current direction
 * (index 0 for SOBO, last point for NOBO).
 */
export function resolveAheadSliceStartIndex({
	points,
	direction,
	userLocation,
	closestPoint,
	offTrailThresholdM,
}: ResolveAheadSliceStartArgs): number {
	if (!points.length) return 0;
	if (userLocation && closestPoint && closestPoint.distance <= offTrailThresholdM) {
		return findNearestPointIndex(points, closestPoint.distanceFromStart);
	}
	return direction === 'SOBO' ? 0 : points.length - 1;
}

/** Builds the trail-point slice covering the next `kmAhead` km from `fromIdx`. */
export function buildAheadTrailSlice({
	points,
	fromIdx,
	direction,
	kmAhead,
}: AheadTrailSliceArgs): PredictivePrecacheSlicePoint[] {
	if (!points.length || fromIdx < 0 || fromIdx >= points.length) return [];

	const aheadM = (kmAhead ?? PRECACHE_AHEAD_KM) * 1000;
	const baseDist = points[fromIdx].distanceFromStart;
	if (direction === 'SOBO') {
		const targetIdx = findNearestPointIndex(points, baseDist + aheadM);
		return points.slice(fromIdx, targetIdx + 1);
	}
	const targetIdx = findNearestPointIndex(points, baseDist - aheadM);
	return points.slice(targetIdx, fromIdx + 1).reverse();
}

/** Tile URLs for the high-detail ahead pack (zoom 15 only, narrow corridor). */
export function generateAheadHighDetailTileUrls(slice: PredictivePrecacheSlicePoint[], urlTemplate: string): string[] {
	return generateTrailTileUrls(slice, urlTemplate, PRECACHE_ZOOM_MAX_HIGH, PRECACHE_ZOOM_MAX_HIGH);
}

/** Resolves the ahead slice for the optional high-detail pack (default 50 km). */
export function buildHighDetailAheadSlice(
	args: ResolveAheadSliceStartArgs & { kmAhead?: number },
): PredictivePrecacheSlicePoint[] {
	const fromIdx = resolveAheadSliceStartIndex(args);
	return buildAheadTrailSlice({
		points: args.points,
		fromIdx,
		direction: args.direction,
		kmAhead: args.kmAhead ?? HIGH_DETAIL_AHEAD_KM,
	});
}

// ── Predictive pre-cache ──────────────────────────────────────────────────────
/** Throttle bucket size - kept equal to PRECACHE_AHEAD_KM so each forward window maps to exactly one bucket. */
const PREDICTIVE_BUCKET_KM = PRECACHE_AHEAD_KM;

/**
 * Module-scoped throttle. Survives React re-renders and selector resubscriptions.
 * Bucket key is `${direction}:${floor(positionKm / 20) * 20}` - position-snapped
 * (not forward-segment identity), which is good enough for the spec's "same
 * forward 20 km" intent and avoids redundant runs as the user progresses through
 * a bucket. Cleared via `resetPredictivePrecacheBuckets()` on direction change.
 */
const visitedPrecacheBuckets = new Set<string>();

/**
 * Module-scoped AbortController for the in-flight predictive run. Predictive runs
 * are coordinated outside React, so the controller lives at module scope rather
 * than in component state. `abortPredictivePrecache()` is idempotent.
 */
let predictivePrecacheAbortController: AbortController | null = null;

export function resetPredictivePrecacheBuckets(): void {
	visitedPrecacheBuckets.clear();
}

export function abortPredictivePrecache(): void {
	predictivePrecacheAbortController?.abort();
	predictivePrecacheAbortController = null;
}

// Shared Navigator extension types - also consumed by ServiceWorkerProvider.
export type NavigatorWithConnection = Navigator & {
	connection?: {
		type?: string;
		effectiveType?: string;
		addEventListener?: (type: 'change', handler: () => void) => void;
		removeEventListener?: (type: 'change', handler: () => void) => void;
	};
};

export interface BatteryManager {
	level: number;
	charging: boolean;
	addEventListener(type: 'levelchange' | 'chargingchange', handler: () => void): void;
	removeEventListener(type: 'levelchange' | 'chargingchange', handler: () => void): void;
}

export type NavigatorWithBattery = Navigator & {
	getBattery?: () => Promise<BatteryManager>;
};

export interface PredictivePrecacheArgs {
	points: Pick<EnhancedTrailPoint, 'lat' | 'lng' | 'distanceFromStart'>[];
	fromIdx: number;
	direction: TrailDirection;
	providerName: string;
	kmAhead?: number;
}

/**
 * Caches tiles ahead of the user along the trail. Reuses corridor generation +
 * `precacheTiles` but with a smaller slice (default 20 km). No UI progress is
 * surfaced - runs silently. Idempotent within a 20 km bucket per direction
 * (call `resetPredictivePrecacheBuckets()` on direction change).
 */
export interface PredictivePrecacheRunResult {
	/** The tile precache outcome, or null when the run was cancelled mid-flight. */
	result: PrecacheResult | null;
	/** The corridor slice that was just cached. The store passes this to
	 *  `prefetchPoisAlongSlice` so the POI asset prefetch covers the same
	 *  km range, without tile-cache.ts having to depend on the POI layer. */
	slice: PredictivePrecacheSlicePoint[];
	/** The abort signal driving this run. Shared so the follow-up POI prefetch
	 *  can be cancelled by the same controller (e.g. on a direction change). */
	signal: AbortSignal;
}

export async function runPredictivePrecache({
	points,
	fromIdx,
	direction,
	providerName,
	kmAhead = PRECACHE_AHEAD_KM,
}: PredictivePrecacheArgs): Promise<PredictivePrecacheRunResult | null> {
	if (!isProviderCacheable(providerName)) return null;
	const urlTemplate = getTileUrlTemplate(providerName);
	if (!urlTemplate) return null;
	if (!points.length || fromIdx < 0 || fromIdx >= points.length) return null;

	const fromKm = points[fromIdx].distanceFromStart / 1000;
	const bucketStartKm = Math.floor(fromKm / PREDICTIVE_BUCKET_KM) * PREDICTIVE_BUCKET_KM;
	const bucketKey = `${direction}:${bucketStartKm}`;
	if (visitedPrecacheBuckets.has(bucketKey)) return null;
	visitedPrecacheBuckets.add(bucketKey);

	const slice = buildAheadTrailSlice({ points, fromIdx, direction, kmAhead });
	if (slice.length < 2) return null;

	const urls = generateTrailTileUrls(slice, urlTemplate, PRECACHE_ZOOM_MIN, PRECACHE_ZOOM_MAX);
	if (!urls.length) return null;

	const storage = await estimateStorage();
	if (!storage.available) return null;

	predictivePrecacheAbortController?.abort();
	const controller = new AbortController();
	predictivePrecacheAbortController = controller;
	try {
		const tileResult = await precacheTiles(urls, () => {}, controller.signal);
		return { result: tileResult, slice, signal: controller.signal };
	} catch {
		return null;
	} finally {
		if (predictivePrecacheAbortController === controller) {
			predictivePrecacheAbortController = null;
		}
	}
}

// ── Cache info & management ───────────────────────────────────────────────────

/** Returns the number of tiles cached for a specific provider. */
export async function getProviderTileCount(providerKey: string): Promise<number> {
	if (typeof caches === 'undefined') return 0;
	try {
		const cache = await caches.open(`${TILE_CACHE_PREFIX}${providerKey}`);
		const keys = await cache.keys();
		return keys.length;
	} catch {
		return 0;
	}
}

/** Clears tiles for a specific provider (or all providers if key omitted). */
export async function clearTileCache(providerKey?: string): Promise<void> {
	if (typeof caches === 'undefined') return;
	if (providerKey) {
		await caches.delete(`${TILE_CACHE_PREFIX}${providerKey}`);
		await clearTileCacheMeta(providerKey);
	} else {
		const cacheNames = await caches.keys();
		await Promise.all(cacheNames.filter((n) => n.startsWith(TILE_CACHE_PREFIX)).map((n) => caches.delete(n)));
		await metaStore.clear();
	}
}

// ── Metadata ──────────────────────────────────────────────────────────────────

const metaStore = localforage.createInstance({
	name: 'cldt-map',
	storeName: 'tile-cache-meta',
});

const META_KEY_PREFIX = 'meta-';

export async function saveTileCacheMeta(providerKey: string, meta: TileCacheMeta): Promise<void> {
	await metaStore.setItem(META_KEY_PREFIX + providerKey, meta);
}

export async function getTileCacheMeta(providerKey: string): Promise<TileCacheMeta | null> {
	return metaStore.getItem<TileCacheMeta>(META_KEY_PREFIX + providerKey);
}

async function clearTileCacheMeta(providerKey: string): Promise<void> {
	await metaStore.removeItem(META_KEY_PREFIX + providerKey);
}

/** Returns true when the cache metadata exists and is older than TILE_CACHE_TTL_MS. */
export function isCacheStale(meta: TileCacheMeta | null): boolean {
	if (!meta) return false;
	return Date.now() - meta.cachedAt > TILE_CACHE_TTL_MS;
}

// ── Storage estimation ────────────────────────────────────────────────────────

export async function estimateStorage(): Promise<StorageEstimate> {
	if (typeof navigator === 'undefined' || !('storage' in navigator)) {
		return { available: true, usedPercent: 0, freeBytes: Number.POSITIVE_INFINITY };
	}
	try {
		const { usage = 0, quota = 0 } = await navigator.storage.estimate();
		const usedPercent = quota > 0 ? (usage / quota) * 100 : 0;
		return { available: usedPercent < 90, usedPercent, freeBytes: quota - usage };
	} catch {
		return { available: true, usedPercent: 0, freeBytes: Number.POSITIVE_INFINITY };
	}
}

// ── Storage persistence ───────────────────────────────────────────────────────

/**
 * Ask the browser to mark our origin storage as persistent so the tile cache
 * (potentially gigabytes of trail tiles) is not silently evicted under storage
 * pressure mid-trek. Without this, Cache Storage is best-effort and can be
 * cleared by the browser at any time. Idempotent and safe to call repeatedly:
 * if persistence is already granted we skip the request. Returns the final
 * persisted state, or false when the API is unavailable or the request fails
 * (e.g. Safari, which grants automatically and may not expose persist()).
 */
export async function requestPersistentStorage(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !('storage' in navigator)) return false;
	const storage = navigator.storage;
	if (typeof storage.persist !== 'function') return false;
	try {
		if (typeof storage.persisted === 'function' && (await storage.persisted())) return true;
		return await storage.persist();
	} catch {
		return false;
	}
}
