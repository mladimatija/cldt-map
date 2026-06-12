/**
 * Server-side share link storage (Netlify Blobs). Import only from API routes,
 * Route Handlers, and Netlify scheduled functions - never from client components.
 */
import { randomBytes } from 'crypto';
import { getStore, type Store } from '@netlify/blobs';
import { SHARE_QUERY_PARAM_KEYS } from '@/lib/share-url-constants';

export const SHARE_LINKS_BLOB_STORE = 'share-links';
export const SHARE_LINK_TTL_MS = 90 * 86_400_000;
export const SHARE_TARGET_MAX_LEN = 2048;
export const SHARE_CODE_PATTERN = /^[A-Za-z0-9_-]{7}$/;

export interface ShareLinkRecord {
	/** Pathname + search only, e.g. `/?progress=42.50&dir=SOBO`. */
	target: string;
	createdAt: string;
	expiresAt: string;
	hits: number;
}

export function getShareLinksStore(): Store {
	return getStore(SHARE_LINKS_BLOB_STORE);
}

export function generateShareCode(): string {
	return randomBytes(5).toString('base64url').slice(0, 7);
}

/** Returns pathname + search when the URL is a same-origin share link, else null. */
export function normalizeShareTarget(inputUrl: string, allowedHost: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(inputUrl);
	} catch {
		return null;
	}

	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
	if (parsed.username || parsed.password) return null;
	if (parsed.host !== allowedHost) return null;
	if (parsed.pathname !== '/') return null;
	if (parsed.hash) return null;
	if (parsed.search.length > SHARE_TARGET_MAX_LEN) return null;

	const params = new URLSearchParams(parsed.search);
	if (!SHARE_QUERY_PARAM_KEYS.some((key) => params.has(key))) return null;

	return `/${parsed.search}`;
}

export function createShareLinkRecord(target: string, now = Date.now()): ShareLinkRecord {
	const createdAt = new Date(now).toISOString();
	return {
		target,
		createdAt,
		expiresAt: new Date(now + SHARE_LINK_TTL_MS).toISOString(),
		hits: 0,
	};
}

export function isShareLinkExpired(record: ShareLinkRecord, now = Date.now()): boolean {
	return Date.parse(record.expiresAt) <= now;
}

export async function createShortShareLink(target: string): Promise<{ code: string; record: ShareLinkRecord } | null> {
	const store = getShareLinksStore();
	const record = createShareLinkRecord(target);

	for (let attempt = 0; attempt < 5; attempt++) {
		const code = generateShareCode();
		const existing = await store.get(code);
		if (existing) continue;
		await store.setJSON(code, record);
		return { code, record };
	}

	return null;
}

export async function resolveShortShareLink(code: string): Promise<ShareLinkRecord | 'missing' | 'expired'> {
	if (!SHARE_CODE_PATTERN.test(code)) return 'missing';

	const store = getShareLinksStore();
	const record = (await store.get(code, { type: 'json' })) as ShareLinkRecord | null;
	if (!record || typeof record.target !== 'string') return 'missing';
	if (isShareLinkExpired(record)) return 'expired';

	record.hits = (record.hits ?? 0) + 1;
	await store.setJSON(code, record);
	return record;
}

export async function deleteExpiredShareLinks(): Promise<{ scanned: number; deleted: number }> {
	const store = getShareLinksStore();
	const now = Date.now();
	let scanned = 0;
	let deleted = 0;

	for await (const page of store.list({ paginate: true })) {
		for (const blob of page.blobs) {
			scanned++;
			const record = (await store.get(blob.key, { type: 'json' })) as ShareLinkRecord | null;
			if (!record || isShareLinkExpired(record, now)) {
				await store.delete(blob.key);
				deleted++;
			}
		}
	}

	return { scanned, deleted };
}

export function isShareShortenerConfigured(): boolean {
	return Boolean(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT);
}
