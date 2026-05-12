/**
 * Server-only defenses shared by the /api/proxy, /api/dhmz-weather, and /api/meteoalarm routes.
 *
 * - enforceRateLimit: in-memory sliding-window per IP. Works in dev and single-instance
 *   deployments. For multi-instance serverless deployments, prefer edge-layer rate limiting
 *   (Vercel firewall, CDN) or upgrade this to a KV/Redis-backed limiter.
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

const RATE_LIMIT_BUCKETS = new Map<string, number[]>();

interface RateLimitOptions {
	windowMs: number;
	max: number;
	name: string;
}

export function enforceRateLimit(request: NextRequest, options: RateLimitOptions): NextResponse | null {
	const ip = getClientIp(request);
	const key = `${options.name}:${ip}`;
	const now = Date.now();
	const windowStart = now - options.windowMs;

	const timestamps = RATE_LIMIT_BUCKETS.get(key) ?? [];
	const recent = timestamps.filter((t) => t > windowStart);

	if (recent.length >= options.max) {
		return NextResponse.json(
			{ error: 'Rate limit exceeded' },
			{
				status: 429,
				headers: {
					'Retry-After': String(Math.ceil(options.windowMs / 1000)),
				},
			},
		);
	}

	recent.push(now);
	RATE_LIMIT_BUCKETS.set(key, recent);
	pruneExpiredBuckets(now);
	return null;
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
function pruneExpiredBuckets(now: number): void {
	if (now - lastPruneAt < 60_000) return;
	lastPruneAt = now;
	for (const [key, timestamps] of RATE_LIMIT_BUCKETS) {
		if (timestamps.length === 0 || timestamps[timestamps.length - 1] < now - 5 * 60_000) {
			RATE_LIMIT_BUCKETS.delete(key);
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

	const declared = parseInt(response.headers.get('content-length') ?? '0', 10);
	if (declared > maxBytes) {
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
	let body = '';
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > maxBytes) {
			await reader.cancel().catch(() => {});
			return { ok: false, status: 502, reason: 'Response body exceeded size limit' };
		}
		body += decoder.decode(value, { stream: true });
	}
	body += decoder.decode();

	return { ok: true, response, body };
}