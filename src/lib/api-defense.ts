/**
 * Server-only defenses shared by the app's server routes (the /api/* proxy and
 * data routes, the /api/narrative and /api/reverse-geocode services, and the
 * /api/share + /s/{code} share-link endpoints).
 *
 * - enforceRateLimit: per-client sliding window from rate-limit-core.ts
 *   (Netlify Blobs across instances, in-memory fallback), returned as a
 *   NextResponse 429. Async because the cross-instance read-modify-write is async.
 *
 * - fetchWithSizeCap: wraps fetch() with a Content-Length precheck AND streamed reading with
 *   a byte counter. Reading is aborted once the running total exceeds maxBytes, so a hostile
 *   or misconfigured upstream cannot allocate a multi-megabyte string in memory.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getClientIp, isRateLimited, type RateLimitOptions } from './rate-limit-core';

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

/**
 * Per-client rate limit shared across the server routes (see rate-limit-core.ts
 * for the Blobs-backed window and how the client address is chosen). Returns a
 * 429 response when the caller is over the limit, otherwise null.
 */
export async function enforceRateLimit(request: NextRequest, options: RateLimitOptions): Promise<NextResponse | null> {
	return (await isRateLimited(getClientIp(request.headers), options)) ? buildRateLimitResponse(options.windowMs) : null;
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
