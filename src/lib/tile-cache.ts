/**
 * Tile cache utilities for offline map support.
 *
 * Responsibilities:
 * - Generate tile URLs for the trail corridor (segmented bounding-box approach)
 * - Drive the pre-cache fetch loop that the Service Worker intercepts
 * - Read/write cache metadata from localforage
 * - Query Cache Storage for tile counts and clear caches
 * - Estimate available storage before a download
 */
import localforage from 'localforage';
import { DEFAULT_MAP_SERVICES } from '@/lib/services/map-service-config';
import { tileCacheTtlDays } from '@/lib/config';
import type { EnhancedTrailPoint } from '@/lib/store/types';

// ── Constants ─────────────────────────────────────────────────────────────────

export const TILE_CACHE_TTL_MS = tileCacheTtlDays * 24 * 60 * 60 * 1000;
export const PRECACHE_ZOOM_MIN = 8;
export const PRECACHE_ZOOM_MAX = 14;
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
export function isProviderCacheable(providerName: string): boolean {
	return providerName in PROVIDER_CACHE_KEY && providerName !== 'CroatiaTopo';
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
	let segLats: number[] = [];
	let segLons: number[] = [];

	for (const pt of points) {
		segLats.push(pt.lat);
		segLons.push(pt.lng);

		if (pt.distanceFromStart - segmentBaseDistance >= SEGMENT_DISTANCE_M) {
			segments.push({
				minLat: Math.min(...segLats) - CORRIDOR_PADDING_DEG,
				maxLat: Math.max(...segLats) + CORRIDOR_PADDING_DEG,
				minLon: Math.min(...segLons) - CORRIDOR_PADDING_DEG,
				maxLon: Math.max(...segLons) + CORRIDOR_PADDING_DEG,
			});
			segmentBaseDistance = pt.distanceFromStart;
			segLats = [pt.lat];
			segLons = [pt.lng];
		}
	}

	if (segLats.length > 0) {
		segments.push({
			minLat: Math.min(...segLats) - CORRIDOR_PADDING_DEG,
			maxLat: Math.max(...segLats) + CORRIDOR_PADDING_DEG,
			minLon: Math.min(...segLons) - CORRIDOR_PADDING_DEG,
			maxLon: Math.max(...segLons) + CORRIDOR_PADDING_DEG,
		});
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
