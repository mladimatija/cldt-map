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
 * dataset, keyed by that version, lets repeat visits hydrate the store
 * instantly and skip both the worker and the parse/enhance entirely. The
 * dataset is the same for both travel directions, so a direction flip needs
 * no reload at all.
 *
 * Invalidation:
 * - A NEXT_PUBLIC_CACHE_VERSION bump changes the key AND re-fetches the GPX.
 * - SCHEMA_VERSION (below) must be bumped whenever ComputedTrailData's shape or
 *   the computeTrailData / parseTrackPoints / TRAIL_SECTIONS logic changes, so
 *   datasets written by an older build are ignored rather than mis-hydrated.
 */

import localforage from 'localforage';
import type { ComputedTrailData } from './trail-compute';

const store = localforage.createInstance({ name: 'cldt-map', storeName: 'trail-computed' });

/** Bump on any change to ComputedTrailData's shape or the enhancement logic.
 *  2: one dataset in file (SOBO) order for both directions.
 *  3: the enhanced points only, without the separate coordinate and elevation copies. */
const SCHEMA_VERSION = 3;

/** Cache key for a given GPX cache version. The dataset no longer depends on
 *  the travel direction, so one record serves both. */
export function computedTrailCacheKey(version: string | undefined): string {
	return `computed:${SCHEMA_VERSION}:${version ?? '1'}`;
}

/** Shape guard: a corrupt or older-schema record is treated as a miss. */
function isComputedTrailData(data: unknown): data is ComputedTrailData {
	if (!data || typeof data !== 'object') return false;
	const d = data as Partial<ComputedTrailData>;
	return (
		Array.isArray(d.enhanced) &&
		d.enhanced.length > 0 &&
		typeof d.hasElevation === 'boolean' &&
		!!d.metadata &&
		typeof d.metadata.totalDistanceM === 'number'
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
 * Persists the computed dataset (best-effort) and prunes every other record,
 * including the per-direction records older builds wrote, so the store holds
 * exactly one dataset. A write failure must never break trail loading.
 */
export async function saveComputedTrail(key: string, data: ComputedTrailData): Promise<void> {
	try {
		await store.setItem(key, data);
		const keys = await store.keys();
		await Promise.all(keys.filter((k) => k !== key).map((k) => store.removeItem(k)));
	} catch {
		// best-effort cache write; ignore quota / private-mode failures
	}
}
