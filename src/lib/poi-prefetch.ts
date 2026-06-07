import { isSafeUrl } from '@/lib/utils';
import { haversineDistanceM } from '@/lib/haversine';
import { loadPois, pickThumbUrl, type Poi } from '@/lib/pois';
import { parseWikipediaRef, SUMMARY_HOST_TEMPLATE } from '@/lib/wikipedia';

/**
 * Offline POI prefetch: warms a dedicated `cldt-pois-v1` Cache Storage bucket
 * with each POI's primary thumbnail and Wikipedia summary so popups render
 * fully offline once the trail corridor has been pre-cached. Cache keys are
 * the original URLs verbatim, so the read path can `caches.match(url)` with
 * no translation.
 */

const POI_CACHE_NAME = 'cldt-pois-v1';
const BATCH_SIZE = 8;

export interface PoiPrefetchProgress {
	done: number;
	total: number;
	cancelled: boolean;
}

export interface PoiPrefetchSummary {
	images: number;
	wikipedia: number;
	skipped: number;
	cancelled: boolean;
}

/**
 * Walks `pois` and fetches each visible POI's `thumbUrl` (or `image`
 * fallback) and Wikipedia REST summary into the dedicated cache. Returns a
 * summary describing how many assets landed in cache vs. were skipped.
 *
 * Skipped reasons (counted into `skipped`):
 *   - No usable thumbnail or wikipedia field
 *   - URL fails `isSafeUrl`
 *   - Fetch network error (cache.put never called)
 *
 * Caller is responsible for filtering `pois` to the corridor / stages they
 * care about - this function fetches everything it's handed.
 */
export async function prefetchPoiAssets(
	pois: Poi[],
	signal: AbortSignal,
	onProgress?: (p: PoiPrefetchProgress) => void,
): Promise<PoiPrefetchSummary> {
	if (typeof caches === 'undefined') {
		return { images: 0, wikipedia: 0, skipped: pois.length, cancelled: false };
	}
	const cache = await caches.open(POI_CACHE_NAME);
	const candidates: { url: string; mode: 'image' | 'wiki' }[] = [];
	for (const poi of pois) {
		const imageUrl = pickThumbUrl(poi);
		if (imageUrl) candidates.push({ url: imageUrl, mode: 'image' });
		const wikiUrl = wikipediaSummaryUrlFor(poi.wikipedia);
		if (wikiUrl) candidates.push({ url: wikiUrl, mode: 'wiki' });
	}
	// Skip URLs that already have a cached response from a prior prefetch -
	// avoids re-paying the network cost on a repeat "Cache offline" / predictive
	// precache pass. Batched in groups of 32 to cap concurrent Cache Storage IPC
	// pressure (each cache.match crosses an IPC boundary to the browser's cache
	// backend; fanning all ~16k at once at 8k+ POIs saturates the IPC queue on
	// low-memory devices).
	const CACHE_CHECK_BATCH = 32;
	const existingHits: (Response | undefined)[] = [];
	for (let i = 0; i < candidates.length; i += CACHE_CHECK_BATCH) {
		const batch = candidates.slice(i, i + CACHE_CHECK_BATCH);
		const hits = await Promise.all(batch.map((c) => cache.match(c.url).catch(() => undefined)));
		existingHits.push(...hits);
	}
	const work = candidates.filter((_, i) => !existingHits[i]);
	const total = work.length;
	let done = 0;
	let images = 0;
	let wikipedia = 0;
	let skipped = 0;

	for (let i = 0; i < work.length; i += BATCH_SIZE) {
		if (signal.aborted) {
			return { images, wikipedia, skipped, cancelled: true };
		}
		const batch = work.slice(i, i + BATCH_SIZE);
		await Promise.allSettled(
			batch.map(async (item) => {
				try {
					// Wikipedia: keep CORS so the body remains readable for the
					// runtime summary fetcher. Images: opaque is fine - the
					// browser rehydrates them as `<img src>` from the cache, and
					// the opaque-response trade-off (silent caching of any
					// response, including poisoned CDN errors) is acceptable for
					// cross-origin media we never parse client-side.
					const init: RequestInit =
						item.mode === 'wiki' ? { signal, headers: { Accept: 'application/json' } } : { signal, mode: 'no-cors' };
					const res = await fetch(item.url, init);
					if (!res || (item.mode === 'wiki' && !res.ok)) {
						skipped++;
						return;
					}
					await cache.put(item.url, res.clone());
					if (item.mode === 'image') images++;
					else wikipedia++;
				} catch {
					skipped++;
				}
			}),
		);
		done = Math.min(i + BATCH_SIZE, total);
		onProgress?.({ done, total, cancelled: false });
	}
	onProgress?.({ done: total, total, cancelled: false });
	return { images, wikipedia, skipped, cancelled: false };
}

/** Cache-Storage probe used by `fetchWikipediaSummary` on the read path. */
export async function matchCachedAsset(url: string): Promise<Response | null> {
	if (typeof caches === 'undefined') return null;
	try {
		const cache = await caches.open(POI_CACHE_NAME);
		return (await cache.match(url)) ?? null;
	} catch {
		return null;
	}
}

/** Returns the number of POI-asset responses currently in cache. Used by the
 *  cache management panel to surface storage usage. */
export async function getPoiAssetCount(): Promise<number> {
	if (typeof caches === 'undefined') return 0;
	try {
		const cache = await caches.open(POI_CACHE_NAME);
		const keys = await cache.keys();
		return keys.length;
	} catch {
		return 0;
	}
}

/** Drops every POI asset from cache. Idempotent. */
export async function clearPoiAssetCache(): Promise<void> {
	if (typeof caches === 'undefined') return;
	try {
		await caches.delete(POI_CACHE_NAME);
	} catch {
		// best-effort
	}
}

/** Off-trail radius (m) within which a POI is considered "in the corridor"
 *  for prefetch purposes. Matches the 5 km off-trail cap the stage planner
 *  uses so the two surfaces agree on what counts as a corridor POI. */
export const POI_PREFETCH_RADIUS_M = 5_000;

/** Lightweight slice shape (lat / lng / cumulative distance along the trail
 *  in metres) accepted by `pickPoisNearSlice` and `prefetchPoisAlongSlice`. */
export interface CorridorSlicePoint {
	lat: number;
	lng: number;
	distanceFromStart: number;
}

/** Filter POIs to those that have any trail point within `radiusM` metres of
 *  the given trail slice. Two-stage filter to avoid the O(N*M) worst case
 *  when the dataset is large (6k+ POIs):
 *
 *    1. Compute the slice's km range from its endpoints. Keep only POIs
 *       whose pre-computed `trailKm` falls inside that range, padded by
 *       (radiusM + offTrailKm) so off-trail POIs near a slice endpoint
 *       aren't excluded.
 *    2. For the survivors, do the per-point haversine scan against the
 *       slice - now over a much smaller pool.
 *
 *  For a 20 km slice and 5 km radius, stage 1 typically drops the candidate
 *  pool from ~6,000 to ~50, cutting the precache prep cost by ~100x. */
export function pickPoisNearSlice(pois: Poi[], slice: CorridorSlicePoint[], radiusM: number): Poi[] {
	if (slice.length === 0) return [];
	const startKm = slice[0].distanceFromStart / 1000;
	const endKm = slice[slice.length - 1].distanceFromStart / 1000;
	const loKm = Math.min(startKm, endKm) - radiusM / 1000;
	const hiKm = Math.max(startKm, endKm) + radiusM / 1000;
	const candidates = pois.filter((p) => p.trailKm >= loKm && p.trailKm <= hiKm);
	const out: Poi[] = [];
	for (const poi of candidates) {
		for (const pt of slice) {
			if (haversineDistanceM(poi.lat, poi.lng, pt.lat, pt.lng) <= radiusM) {
				out.push(poi);
				break;
			}
		}
	}
	return out;
}

/** Fire-and-forget POI prefetch for the POIs near a corridor `slice`.
 *  Resolves to `true` when the prefetch ran (even if some assets failed) and
 *  `false` when there was nothing to do or the signal was already aborted.
 *  Errors inside `prefetchPoiAssets` are swallowed - this is best-effort. */
export async function prefetchPoisAlongSlice(slice: CorridorSlicePoint[], signal: AbortSignal): Promise<boolean> {
	if (signal.aborted) return false;
	const file = await loadPois();
	if (!file?.pois?.length || signal.aborted) return false;
	const corridor = pickPoisNearSlice(file.pois, slice, POI_PREFETCH_RADIUS_M);
	if (corridor.length === 0) return false;
	try {
		await prefetchPoiAssets(corridor, signal);
		return true;
	} catch {
		return false;
	}
}

/** Translate `poi.wikipedia` (which can be "Title" or "hr:Title") into the
 *  REST summary URL `fetchWikipediaSummary` uses, so the read and write
 *  paths agree on the cache key. Returns null for invalid refs. */
function wikipediaSummaryUrlFor(raw: string | undefined): string | null {
	if (!raw) return null;
	const parsed = parseWikipediaRef(raw);
	if (!parsed) return null;
	const url = SUMMARY_HOST_TEMPLATE.replace('{locale}', parsed.locale) + encodeURIComponent(parsed.title);
	return isSafeUrl(url) ? url : null;
}
