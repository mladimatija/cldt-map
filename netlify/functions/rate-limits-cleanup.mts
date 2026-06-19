/**
 * Scheduled cleanup for stale rate-limit buckets in Netlify Blobs.
 *
 * The limiter already filters each bucket to its window on read, so staleness
 * between runs never affects correctness - this only reclaims keys for IPs that
 * have stopped sending traffic. Mirrors share-links-cleanup.mts, but runs
 * @weekly rather than @monthly because rate-limit buckets are far higher
 * cardinality and shorter-lived than share links.
 *
 * The store name ('rate-limits') and the expiresAt convention are the canonical
 * ones in src/lib/api-defense.ts (RATE_LIMIT_BLOB_STORE); they are re-declared
 * here because this function cannot import that server-only module (it pulls in
 * next/server). Keep the two in sync.
 */

import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';

const RATE_LIMIT_BLOB_STORE = 'rate-limits';

/** Keys deleted per concurrent batch - keeps memory flat while cutting wall-clock round-trips. */
const CLEANUP_BATCH_SIZE = 20;

export default async function handler(): Promise<Response> {
	try {
		const store = getStore(RATE_LIMIT_BLOB_STORE);
		const now = Date.now();
		let scanned = 0;
		let deleted = 0;

		for await (const page of store.list({ paginate: true })) {
			for (let i = 0; i < page.blobs.length; i += CLEANUP_BATCH_SIZE) {
				const batch = page.blobs.slice(i, i + CLEANUP_BATCH_SIZE);
				scanned += batch.length;
				const outcomes = await Promise.all(
					batch.map(async (blob) => {
						// Metadata-only read (no body): the limiter stamps expiresAt into metadata.
						const meta = await store.getMetadata(blob.key);
						const expiresAt = meta?.metadata?.expiresAt;
						if (typeof expiresAt !== 'number' || expiresAt <= now) {
							await store.delete(blob.key);
							return true;
						}
						return false;
					}),
				);
				deleted += outcomes.filter(Boolean).length;
			}
		}

		return new Response(`rate-limits cleanup: scanned=${scanned} deleted=${deleted}`, { status: 200 });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('rate-limits-cleanup failed:', message);
		return new Response('cleanup failed', { status: 500 });
	}
}

export const config: Config = {
	schedule: '@weekly',
};
