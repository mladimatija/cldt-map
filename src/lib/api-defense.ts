/**
 * Server-only defenses shared by the app's server routes (the /api/* proxy and
 * data routes, the /api/narrative and /api/reverse-geocode services, and the
 * /api/share + /s/{code} share-link endpoints).
 *
 * - enforceRateLimit: per-IP sliding window. Backed by Netlify Blobs so the limit holds
 *   across serverless instances and cold starts; falls back to an in-memory per-instance
 *   window for local dev or when Blobs is momentarily unreachable. Async because the
 *   cross-instance read-modify-write is async.
 *
 *   IP source: reads the RIGHTMOST entry in x-forwarded-for (the closest trusted proxy hop)
 *   and validates it's a syntactically-valid IPv4 or IPv6 literal. This makes header injection
 *   meaningfully harder: an attacker hitting the app directly with a forged x-forwarded-for
 *   will land in the "unknown" bucket. The deployment assumption is that this app sits behind
 *   a trusted proxy/CDN that sets x-forwarded-for (Vercel, Cloudflare, etc.) and that the
 *   final hop value in that header is the real client IP.
 *
 * - fetchWithSizeCap: wraps fetch() with a Content-Length precheck AND streamed reading with
 *   a byte counter. Reading is aborted once the running total exceeds maxBytes, so a hostile
 *   or misconfigured upstream cannot allocate a multi-megabyte string in memory.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getStore } from '@netlify/blobs';

const IN_MEMORY_RATE_LIMIT_BUCKETS = new Map<string, number[]>();

interface RateLimitOptions {
	windowMs: number;
	max: number;
	name: string;
}

/**
 * Netlify Blobs store holding cross-instance rate-limit buckets, one per `name:ip`.
 * The matching cleanup sweep in netlify/functions/rate-limits-cleanup.mts re-declares
 * this store name and the bucket shape - it cannot import this server-only module
 * (which pulls in next/server), mirroring the share-links-cleanup convention. Keep
 * the two in sync.
 */
export const RATE_LIMIT_BLOB_STORE = 'rate-limits';

/**
 * Optimistic-concurrency write attempts before the KV limiter gives up and fails
 * open. Each retry re-reads the bucket, so a small budget absorbs the occasional
 * concurrent writer without ever erroring a legitimate request.
 */
const KV_MAX_WRITE_ATTEMPTS = 4;

interface RateLimitBucket {
	/** Request timestamps (ms) inside the retention window; bounded by `max` (window filtering plus the over-limit guard keep it from growing unbounded). */
	hits: number[];
	/** Epoch ms after which the whole bucket is stale; also mirrored into blob metadata so the cleanup sweep can decide deletions without a full-body read. */
	expiresAt: number;
}

function buildRateLimitResponse(windowMs: number): NextResponse {
	return NextResponse.json(
		{ error: 'Rate limit exceeded' },
		{
			status: 429,
			headers: {
				'Retry-After': String(Math.ceil(windowMs / 1000)),
			},
		},
	);
}

/** True where Netlify Blobs is reachable (production, deploy previews, dev with the blobs context). */
function isBlobsConfigured(): boolean {
	return Boolean(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT);
}

/**
 * In-memory sliding window. The map lives in a single server process, so this
 * only bounds one instance - used for local dev and as the fallback when Blobs
 * is unreachable. Returns a 429 response when over the limit, otherwise null.
 */
function enforceRateLimitInMemory(ip: string, options: RateLimitOptions): NextResponse | null {
	const key = `${options.name}:${ip}`;
	const now = Date.now();
	const windowStart = now - options.windowMs;

	const timestamps = IN_MEMORY_RATE_LIMIT_BUCKETS.get(key) ?? [];
	const recent = timestamps.filter((t) => t > windowStart);

	if (recent.length >= options.max) {
		return buildRateLimitResponse(options.windowMs);
	}

	recent.push(now);
	IN_MEMORY_RATE_LIMIT_BUCKETS.set(key, recent);
	pruneExpiredInMemoryBuckets(now);
	return null;
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
async function enforceRateLimitKv(ip: string, options: RateLimitOptions): Promise<NextResponse | null> {
	const store = getStore(RATE_LIMIT_BLOB_STORE);
	const key = `${options.name}:${ip}`;

	for (let attempt = 0; attempt < KV_MAX_WRITE_ATTEMPTS; attempt++) {
		const now = Date.now();
		const windowStart = now - options.windowMs;

		const existing = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
		const stored = (existing?.data ?? null) as RateLimitBucket | null;
		const recent = (stored?.hits ?? []).filter((t) => t > windowStart);

		if (recent.length >= options.max) {
			return buildRateLimitResponse(options.windowMs);
		}

		recent.push(now);
		const next: RateLimitBucket = { hits: recent, expiresAt: now + options.windowMs };
		// Mirror expiresAt into blob metadata so the weekly cleanup sweep can decide
		// deletions from a metadata-only read instead of fetching each bucket's body.
		const writeMeta = { metadata: { expiresAt: next.expiresAt } };

		// Conditional write: commit only if the bucket is unchanged since our read
		// (matching ETag) or still absent (onlyIfNew). A stale read loses and retries.
		if (existing?.etag) {
			const result = await store.setJSON(key, next, { onlyIfMatch: existing.etag, ...writeMeta });
			if (result.modified) return null;
		} else if (existing) {
			// Entry exists but the backend returned no ETag: fall back to last-writer-wins.
			await store.setJSON(key, next, writeMeta);
			return null;
		} else {
			const result = await store.setJSON(key, next, { onlyIfNew: true, ...writeMeta });
			if (result.modified) return null;
		}
		// A conditional write returned modified === false: a concurrent writer beat
		// us. Loop to re-read the fresh bucket and re-evaluate the limit.
	}

	// Contention budget exhausted: allow the request rather than fail it.
	return null;
}

/**
 * Per-IP rate limit shared across the server routes. Uses the Netlify Blobs-backed
 * limiter when Blobs is available (so the limit is enforced across all instances and
 * survives cold starts), and degrades to the per-instance in-memory limiter for local
 * dev or if Blobs is momentarily unreachable. Returns a 429 response when the caller
 * is over the limit, otherwise null.
 */
export async function enforceRateLimit(request: NextRequest, options: RateLimitOptions): Promise<NextResponse | null> {
	const ip = getClientIp(request);
	if (isBlobsConfigured()) {
		try {
			return await enforceRateLimitKv(ip, options);
		} catch {
			// Blobs unavailable mid-request: fall back to in-memory rather than failing fully open.
			return enforceRateLimitInMemory(ip, options);
		}
	}
	return enforceRateLimitInMemory(ip, options);
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
 * Returns the IP of the closest trusted hop as recorded by the deployment's proxy/CDN.
 * Uses the rightmost non-empty entry in x-forwarded-for - that value is the one the last
 * trusted proxy appended, which an external attacker cannot influence. Headers like x-real-ip
 * are deliberately ignored: when this app runs without a proxy (direct hit), there is no
 * authoritative client-IP source, and accepting any header would re-introduce the bypass
 * this function exists to prevent.
 */
function getClientIp(request: NextRequest): string {
	const forwarded = request.headers.get('x-forwarded-for');
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
	for (const [key, timestamps] of IN_MEMORY_RATE_LIMIT_BUCKETS) {
		if (timestamps.length === 0 || timestamps[timestamps.length - 1] < now - 5 * 60_000) {
			IN_MEMORY_RATE_LIMIT_BUCKETS.delete(key);
		}
	}
}

export async function fetchWithSizeCap(
	url: string,
	init: RequestInit,
	maxBytes: number,
): Promise<{ ok: true; response: Response; body: string } | { ok: false; status: number; reason: string }> {
	const response = await fetch(url, init);

	if (!response.ok) {
		// Don't leak upstream status to clients - the caller logs it server-side from response.status.
		return { ok: false, status: response.status, reason: 'Upstream error' };
	}

	// Three cases: header absent (skip precheck), header present but non-numeric
	// (skip precheck, let the streamed counter enforce the cap), header present and valid.
	const rawLength = response.headers.get('content-length');
	const declared = rawLength !== null ? Number(rawLength) : null;
	if (declared !== null && Number.isFinite(declared) && declared > maxBytes) {
		return { ok: false, status: 502, reason: 'Response too large' };
	}

	if (!response.body) {
		const body = await response.text();
		// Multi-byte UTF-8 means string.length undercounts bytes; check both.
		if (body.length > maxBytes || new TextEncoder().encode(body).length > maxBytes) {
			return { ok: false, status: 502, reason: 'Response body exceeded size limit' };
		}
		return { ok: true, response, body };
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const chunks: string[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > maxBytes) {
			await reader.cancel().catch(() => {});
			return { ok: false, status: 502, reason: 'Response body exceeded size limit' };
		}
		chunks.push(decoder.decode(value, { stream: true }));
	}
	chunks.push(decoder.decode());

	return { ok: true, response, body: chunks.join('') };
}
