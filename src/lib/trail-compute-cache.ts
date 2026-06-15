'use client';

/**
 * Persisted cache of the worker-computed trail dataset (localforage / IndexedDB).
 *
 * Cold-loading the trail parses the GPX and runs the O(n) enhancement pass
 * (cumulative distance, gain/loss, section, bearing, grade per point) - the
 * single largest start-up block, even when offloaded to the trail worker. A
 * prior visit's result is reusable verbatim because, within one
 * NEXT_PUBLIC_CACHE_VERSION, `fetchGPXWithCache` always serves the same GPX
 * text (it only re-fetches when the version changes). So caching the computed
 * dataset, keyed by that version + travel direction, lets repeat visits (and
 * SOBO<->NOBO flips) hydrate the store instantly and skip both the worker and
 * the parse/enhance entirely.
 *
 * Invalidation:
 * - A NEXT_PUBLIC_CACHE_VERSION bump changes the key AND re-fetches the GPX.
 * - SCHEMA_VERSION (below) must be bumped whenever ComputedTrailData's shape or
 *   the computeTrailData / parseTrackPoints / TRAIL_SECTIONS logic changes, so
 *   datasets written by an older build are ignored rather than mis-hydrated.
 */

import localforage from 'localforage';
import type { ComputedTrailData } from './trail-compute';
import type { TrailDirection } from './store/types';

const store = localforage.createInstance({ name: 'cldt-map', storeName: 'trail-computed' });

/** Bump on any change to ComputedTrailData's shape or the enhancement logic. */
const SCHEMA_VERSION = 1;

/** Cache key for a given GPX cache version + direction. */
export function computedTrailCacheKey(version: string | undefined, direction: TrailDirection): string {
	return `computed:${SCHEMA_VERSION}:${version ?? '1'}:${direction}`;
}

/** Shape guard: a corrupt or older-schema record is treated as a miss. */
function isComputedTrailData(data: unknown): data is ComputedTrailData {
	if (!data || typeof data !== 'object') return false;
	const d = data as Partial<ComputedTrailData>;
	return (
		Array.isArray(d.enhanced) &&
		d.enhanced.length > 0 &&
		Array.isArray(d.points) &&
		d.points.length === d.enhanced.length &&
		Array.isArray(d.elevationPoints) &&
		!!d.metadata &&
		typeof (d.metadata).totalDistanceM === 'number'
	);
}

/** Returns the cached dataset for `key`, or null on miss / corruption / error. */
export async function loadComputedTrail(key: string): Promise<ComputedTrailData | null> {
	try {
		const data = await store.getItem<unknown>(key);
		return isComputedTrailData(data) ? data : null;
	} catch {
		return null;
	}
}

/**
 * Persists the computed dataset (best-effort) and prunes entries from other
 * schema/version generations so the store holds at most the current version's
 * two direction records. A write failure must never break trail loading.
 */
export async function saveComputedTrail(key: string, data: ComputedTrailData): Promise<void> {
	try {
		await store.setItem(key, data);
		// Generation prefix INCLUDING the trailing ":" so it stays delimited - e.g.
		// "computed:1:1:" must not prefix-match a different version's "computed:1:10:".
		const prefix = key.slice(0, key.lastIndexOf(':') + 1);
		const keys = await store.keys();
		await Promise.all(keys.filter((k) => !k.startsWith(prefix)).map((k) => store.removeItem(k)));
	} catch {
		// best-effort cache write; ignore quota / private-mode failures
	}
}
