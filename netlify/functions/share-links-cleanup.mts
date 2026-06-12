/**
 * Scheduled cleanup for expired `/s/{code}` entries in Netlify Blobs.
 * Runs monthly; lazy expiry on redirect handles the hot path between runs.
 */

import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';

const SHARE_LINKS_BLOB_STORE = 'share-links';

interface ShareLinkRecord {
	target: string;
	createdAt: string;
	expiresAt: string;
	hits?: number;
}

export default async function handler(): Promise<Response> {
	try {
		const store = getStore(SHARE_LINKS_BLOB_STORE);
		const now = Date.now();
		let scanned = 0;
		let deleted = 0;

		for await (const page of store.list({ paginate: true })) {
			for (const blob of page.blobs) {
				scanned++;
				const record = (await store.get(blob.key, { type: 'json' })) as ShareLinkRecord | null;
				if (!record || Date.parse(record.expiresAt) <= now) {
					await store.delete(blob.key);
					deleted++;
				}
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
