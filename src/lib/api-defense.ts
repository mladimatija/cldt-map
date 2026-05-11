/**
 * Server-only defenses shared by the /api/proxy, /api/dhmz-weather, and /api/meteoalarm routes.
 *
 * - enforceRateLimit: in-memory sliding-window per IP. Works in dev and single-instance deployments.
 *   For multi-instance serverless deployments, prefer edge-layer rate limiting (Vercel firewall, CDN)
 *   or upgrade this to a KV/Redis-backed limiter.
 * - fetchWithSizeCap: wraps fetch() with a Content-Length precheck and a post-read size check,
 *   so a misconfigured or hostile upstream cannot OOM the server with a multi-gigabyte response.
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

function getClientIp(request: NextRequest): string {
	const forwarded = request.headers.get('x-forwarded-for');
	if (forwarded) return forwarded.split(',')[0].trim();
	const real = request.headers.get('x-real-ip');
	if (real) return real.trim();
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
		return { ok: false, status: response.status, reason: `Upstream returned ${response.status}` };
	}

	const declared = parseInt(response.headers.get('content-length') ?? '0', 10);
	if (declared > maxBytes) {
		return { ok: false, status: 502, reason: 'Response too large' };
	}

	const body = await response.text();
	if (body.length > maxBytes) {
		return { ok: false, status: 502, reason: 'Response body exceeded size limit' };
	}

	return { ok: true, response, body };
}
