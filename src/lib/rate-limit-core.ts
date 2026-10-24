/**
 * Framework-agnostic per-client sliding-window rate limiter: no `next/server`
 * import and no path aliases, so Netlify functions can use it as well as the
 * Next route handlers (which wrap it in api-defense.ts).
 *
 * Backed by Netlify Blobs so the limit holds across serverless instances and
 * cold starts; falls back to an in-memory per-instance window for local dev or
 * when Blobs is momentarily unreachable.
 */
import { getStore } from '@netlify/blobs';

export interface RateLimitOptions {
	windowMs: number;
	max: number;
	name: string;
}

/**
 * Netlify Blobs store holding cross-instance rate-limit buckets, one per `name:ip`.
 * The matching cleanup sweep in netlify/functions/rate-limits-cleanup.mts
 * re-declares this store name and the bucket shape. Keep the two in sync.
 */
export const RATE_LIMIT_BLOB_STORE = 'rate-limits';

/**
 * Optimistic-concurrency write attempts before the KV limiter gives up and fails
 * open. Each retry re-reads the bucket, so a small budget absorbs the occasional
 * concurrent writer without ever erroring a legitimate request.
 */
const KV_MAX_WRITE_ATTEMPTS = 4;

export interface RateLimitBucket {
	/** Request timestamps (ms) inside the retention window; bounded by `max` (window filtering plus the over-limit guard keep it from growing unbounded). */
	hits: number[];
	/** Epoch ms after which the whole bucket is stale; also mirrored into blob metadata so the cleanup sweep can decide deletions without a full-body read. */
	expiresAt: number;
}

interface InMemoryBucket {
	hits: number[];
	/** The bucket's own window, so pruning never drops an hourly window early. */
	windowMs: number;
}

const IN_MEMORY_RATE_LIMIT_BUCKETS = new Map<string, InMemoryBucket>();

/** True where Netlify Blobs is reachable (production, deploy previews, dev with the blobs context). */
export function isBlobsConfigured(): boolean {
	return Boolean(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT);
}

const IPV4_PATTERN = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
// Accepts a leading '::' for compressed loopback/unspecified forms (e.g. ::1, ::ffff:1.2.3.4),
// otherwise requires hex-digit start. End must be hex digit. At least one colon required.
// Rejects strings of pure colons like '::::' that the looser pattern previously accepted.
const IPV6_PATTERN = /^(?:::|[0-9a-fA-F])[0-9a-fA-F:.]*[0-9a-fA-F]$/;

function isValidIp(value: string): boolean {
	if (IPV4_PATTERN.test(value)) return true;
	return value.includes(':') && IPV6_PATTERN.test(value);
}

/**
 * Client address used as the rate-limit key.
 *
 * On Netlify, `x-nf-client-connection-ip` is the address Netlify's edge saw and
 * the client IP Netlify documents as reliable. The rightmost x-forwarded-for
 * entry there can be an internal proxy hop, which would put every visitor in
 * one shared bucket per proxy node. The header is trusted only on Netlify,
 * where the edge sets it; elsewhere a client could forge it.
 *
 * Otherwise (local dev, other hosts) the rightmost valid x-forwarded-for entry
 * is used: the value the last trusted proxy appended, which an external
 * attacker cannot influence. Headers like x-real-ip are deliberately ignored:
 * without a proxy there is no authoritative client-IP source, and accepting
 * any header would re-open the bypass this guards against.
 */
export function getClientIp(headers: Headers): string {
	if (isBlobsConfigured()) {
		const netlifyIp = headers.get('x-nf-client-connection-ip')?.trim();
		if (netlifyIp && isValidIp(netlifyIp)) return netlifyIp;
	}
	const forwarded = headers.get('x-forwarded-for');
	if (forwarded) {
		const entries = forwarded.split(',').map((s) => s.trim());
		for (let i = entries.length - 1; i >= 0; i--) {
			const candidate = entries[i];
			if (candidate && isValidIp(candidate)) return candidate;
		}
	}
	return 'unknown';
}

let lastPruneAt = 0;
function pruneExpiredInMemoryBuckets(now: number): void {
	if (now - lastPruneAt < 60_000) return;
	lastPruneAt = now;
	for (const [key, bucket] of IN_MEMORY_RATE_LIMIT_BUCKETS) {
		const newest = bucket.hits[bucket.hits.length - 1];
		if (newest === undefined || newest <= now - bucket.windowMs) {
			IN_MEMORY_RATE_LIMIT_BUCKETS.delete(key);
		}
	}
}

/**
 * In-memory sliding window. The map lives in a single server process, so this
 * only bounds one instance - used for local dev and as the fallback when Blobs
 * is unreachable.
 */
function isOverLimitInMemory(key: string, options: RateLimitOptions): boolean {
	const now = Date.now();
	const windowStart = now - options.windowMs;

	const recent = (IN_MEMORY_RATE_LIMIT_BUCKETS.get(key)?.hits ?? []).filter((t) => t > windowStart);
	if (recent.length >= options.max) return true;

	recent.push(now);
	IN_MEMORY_RATE_LIMIT_BUCKETS.set(key, { hits: recent, windowMs: options.windowMs });
	pruneExpiredInMemoryBuckets(now);
	return false;
}

/**
 * Cross-instance sliding window backed by Netlify Blobs, so the limit holds
 * across serverless instances and cold starts (the in-memory map does not).
 *
 * Each bucket is a small JSON blob keyed `${name}:${ip}`. The read-modify-write
 * is made safe under concurrency with Blobs conditional writes (onlyIfMatch /
 * onlyIfNew against the read ETag): a writer whose read went stale loses the
 * write, re-reads, and retries. Once the attempt budget is spent the limiter
 * fails open rather than erroring a valid request.
 */
async function isOverLimitKv(key: string, options: RateLimitOptions): Promise<boolean> {
	const store = getStore(RATE_LIMIT_BLOB_STORE);

	for (let attempt = 0; attempt < KV_MAX_WRITE_ATTEMPTS; attempt++) {
		const now = Date.now();
		const windowStart = now - options.windowMs;

		const existing = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
		const stored = (existing?.data ?? null) as RateLimitBucket | null;
		const recent = (stored?.hits ?? []).filter((t) => t > windowStart);

		if (recent.length >= options.max) return true;

		recent.push(now);
		const next: RateLimitBucket = { hits: recent, expiresAt: now + options.windowMs };
		// Mirror expiresAt into blob metadata so the weekly cleanup sweep can decide
		// deletions from a metadata-only read instead of fetching each bucket's body.
		const writeMeta = { metadata: { expiresAt: next.expiresAt } };

		// Conditional write: commit only if the bucket is unchanged since our read
		// (matching ETag) or still absent (onlyIfNew). A stale read loses and retries.
		if (existing?.etag) {
			const result = await store.setJSON(key, next, { onlyIfMatch: existing.etag, ...writeMeta });
			if (result.modified) return false;
		} else if (existing) {
			// Entry exists but the backend returned no ETag: fall back to last-writer-wins.
			await store.setJSON(key, next, writeMeta);
			return false;
		} else {
			const result = await store.setJSON(key, next, { onlyIfNew: true, ...writeMeta });
			if (result.modified) return false;
		}
		// A conditional write returned modified === false: a concurrent writer beat
		// us. Loop to re-read the fresh bucket and re-evaluate the limit.
	}

	// Contention budget exhausted: allow the request rather than fail it.
	return false;
}

/**
 * True when `clientKey` has used up `options.max` requests within the window
 * (that request is then not counted). Uses the Blobs-backed limiter where Blobs
 * is available and degrades to the in-memory limiter for local dev or if Blobs
 * is momentarily unreachable.
 */
export async function isRateLimited(clientKey: string, options: RateLimitOptions): Promise<boolean> {
	const key = `${options.name}:${clientKey}`;
	if (isBlobsConfigured()) {
		try {
			return await isOverLimitKv(key, options);
		} catch {
			// Blobs unavailable mid-request: fall back to in-memory rather than failing fully open.
			return isOverLimitInMemory(key, options);
		}
	}
	return isOverLimitInMemory(key, options);
}
