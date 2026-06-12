/**
 * Server-side share link storage (Netlify Blobs). Import only from API routes,
 * Route Handlers, and Netlify scheduled functions - never from client components.
 */
import { randomBytes } from 'crypto';
import { getStore, type Store } from '@netlify/blobs';
import type { NextRequest } from 'next/server';
import { LOCALES } from '@/i18n/routing';
import { siteMetadata } from '@/lib/metadata';
import { SHARE_QUERY_PARAM_KEYS } from '@/lib/share-url-constants';

export const SHARE_LINKS_BLOB_STORE = 'share-links';
export const SHARE_LINK_TTL_MS = 90 * 86_400_000;
export const SHARE_TARGET_MAX_LEN = 2048;
export const SHARE_CODE_PATTERN = /^[A-Za-z0-9_-]{7}$/;
/** Backoff after a Blobs write before treating a code as missing (eventual consistency). */
export const SHARE_LINK_READ_RETRY_DELAYS_MS = [100, 200, 300, 500, 1000] as const;

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

function addAllowedShareHost(hosts: Set<string>, value: string | null | undefined): void {
	if (!value) return;
	const first = value.split(',')[0]?.trim();
	if (!first) return;
	try {
		const host = (first.includes('://') ? new URL(first).host : first).toLowerCase();
		if (host) hosts.add(host);
	} catch {
		// ignore malformed host values
	}
}

/** Hostnames that may appear in share URLs (custom domain, Netlify URL, request Host header). */
export function collectShareAllowedHosts(request: NextRequest): Set<string> {
	const hosts = new Set<string>();
	addAllowedShareHost(hosts, request.headers.get('x-forwarded-host'));
	addAllowedShareHost(hosts, request.headers.get('host'));
	addAllowedShareHost(hosts, request.nextUrl.host);
	addAllowedShareHost(hosts, process.env.URL);
	addAllowedShareHost(hosts, process.env.DEPLOY_PRIME_URL);
	addAllowedShareHost(hosts, process.env.DEPLOY_URL);
	return hosts;
}

function isLocalDevHost(host: string): boolean {
	const hostname = host.split(':')[0]?.toLowerCase() ?? '';
	return hostname === 'localhost' || hostname === '127.0.0.1';
}

/** Canonical public origin for short links and redirects (always map.cldt.hr in prod). */
export function resolvePublicOrigin(request: NextRequest): string {
	const host =
		request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
		request.headers.get('host') ||
		request.nextUrl.host;
	if (isLocalDevHost(host)) {
		const proto = request.headers.get('x-forwarded-proto') || (request.nextUrl.protocol === 'http:' ? 'http' : 'https');
		return `${proto}://${host}`;
	}
	return siteMetadata.url.replace(/\/$/, '');
}

function isAllowedSharePathname(pathname: string): boolean {
	const normalized = pathname.replace(/\/$/, '') || '/';
	if (normalized === '/') return true;
	return LOCALES.some((locale) => normalized === `/${locale}`);
}

/** Returns pathname + search when the URL is a same-origin share link, else null. */
export function normalizeShareTarget(inputUrl: string, allowedHosts: ReadonlySet<string>): string | null {
	let parsed: URL;
	try {
		parsed = new URL(inputUrl);
	} catch {
		return null;
	}

	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
	if (parsed.username || parsed.password) return null;
	if (!allowedHosts.has(parsed.host.toLowerCase())) return null;
	if (!isAllowedSharePathname(parsed.pathname)) return null;
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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readShareLinkRecord(code: string): Promise<ShareLinkRecord | 'missing' | 'expired'> {
	if (!SHARE_CODE_PATTERN.test(code)) return 'missing';

	const store = getShareLinksStore();
	const record = (await store.get(code, { type: 'json' })) as ShareLinkRecord | null;
	if (!record || typeof record.target !== 'string') return 'missing';
	if (isShareLinkExpired(record)) return 'expired';
	return record;
}

/** Re-read a code with backoff until Blobs catches up after a fresh write. */
async function readShareLinkWithRetry(code: string): Promise<ShareLinkRecord | 'missing' | 'expired'> {
	let result = await readShareLinkRecord(code);
	if (result !== 'missing') return result;

	for (const delayMs of SHARE_LINK_READ_RETRY_DELAYS_MS) {
		await sleep(delayMs);
		result = await readShareLinkRecord(code);
		if (result !== 'missing') return result;
	}

	return 'missing';
}

/** True when a freshly written code is readable (not missing or expired). */
export async function waitForShareLinkReadable(code: string): Promise<boolean> {
	const result = await readShareLinkWithRetry(code);
	return result !== 'missing' && result !== 'expired';
}

export async function createShortShareLink(target: string): Promise<{ code: string; record: ShareLinkRecord } | null> {
	const store = getShareLinksStore();
	const record = createShareLinkRecord(target);

	for (let attempt = 0; attempt < 5; attempt++) {
		const code = generateShareCode();
		const existing = await store.get(code);
		if (existing) continue;
		await store.setJSON(code, record);
		if (!(await waitForShareLinkReadable(code))) {
			try {
				await store.delete(code);
			} catch {
				// ignore cleanup failure; next redirect will still fall back to home
			}
			continue;
		}
		return { code, record };
	}

	return null;
}

export async function resolveShortShareLink(code: string): Promise<ShareLinkRecord | 'missing' | 'expired'> {
	const result = await readShareLinkWithRetry(code);
	if (result === 'missing' || result === 'expired') return result;

	const store = getShareLinksStore();
	result.hits = (result.hits ?? 0) + 1;
	await store.setJSON(code, result);
	return result;
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
