/**
 * Scheduled cleanup for expired `/s/{code}` entries in Netlify Blobs.
 * Runs monthly; lazy expiry on redirect handles the hot path between runs.
 * Like rate-limits-cleanup.mts, it decides from blob metadata and deletes in
 * concurrent batches.
 */

import { getStore, type Store } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { SHARE_LINKS_BLOB_STORE } from '../../src/lib/share-url-constants';

/** Keys checked per concurrent batch - keeps memory flat while cutting wall-clock round-trips. */
const CLEANUP_BATCH_SIZE = 20;

/** The shortener stamps expiresAt (epoch ms) into each link's metadata. Links
 *  written before it did carry it only in the body, which is read instead; they
 *  all expire within the 90-day link lifetime. */
async function isExpired(store: Store, key: string, now: number): Promise<boolean> {
	const meta = await store.getMetadata(key);
	const expiresAt = meta?.metadata?.expiresAt;
	if (typeof expiresAt === 'number') return expiresAt <= now;
	const record = (await store.get(key, { type: 'json' })) as { expiresAt?: unknown } | null;
	return typeof record?.expiresAt !== 'string' || Date.parse(record.expiresAt) <= now;
}

export default async function handler(): Promise<Response> {
	try {
		const store = getStore(SHARE_LINKS_BLOB_STORE);
		const now = Date.now();
		let scanned = 0;
		let deleted = 0;

		for await (const page of store.list({ paginate: true })) {
			for (let i = 0; i < page.blobs.length; i += CLEANUP_BATCH_SIZE) {
				const batch = page.blobs.slice(i, i + CLEANUP_BATCH_SIZE);
				scanned += batch.length;
				const outcomes = await Promise.all(
					batch.map(async (blob) => {
						if (!(await isExpired(store, blob.key, now))) return false;
						await store.delete(blob.key);
						return true;
					}),
				);
				deleted += outcomes.filter(Boolean).length;
			}
		}

		return new Response(`share-links cleanup: scanned=${scanned} deleted=${deleted}`, { status: 200 });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('share-links-cleanup failed:', message);
		return new Response('cleanup failed', { status: 500 });
	}
}

export const config: Config = {
	schedule: '@monthly',
};
