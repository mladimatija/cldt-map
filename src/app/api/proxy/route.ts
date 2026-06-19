/**
 * Server-side proxy for GPX and other external resources. Used to avoid CORS when fetching from cldt.hr.
 * Only allows ALLOWED_HOSTS; rejects non-HTTPS and invalid URLs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, fetchWithSizeCap } from '@/lib/api-defense';

const ALLOWED_HOSTS = ['cldt.hr', 'www.cldt.hr'];
const ALLOWED_PATH_PREFIXES = ['/']; // Adjust to more specific prefixes (e.g. ['/gpx/', '/maps/']) as needed.
const MAX_BODY_BYTES = 25 * 1024 * 1024; // 25 MB - room for large GPX files

/**
 * Reflecting upstream Content-Type verbatim lets a compromised origin trick the browser into
 * parsing the proxied bytes as HTML (CORS wildcard makes this worse). Only known-safe XML-ish
 * types pass through; anything else is downgraded to text/plain.
 */
const ALLOWED_CONTENT_TYPES = ['application/xml', 'text/xml', 'application/gpx+xml'];
function sanitizeContentType(raw: string | null): string {
	if (!raw) return 'text/xml';
	const lower = raw.toLowerCase();
	for (const allowed of ALLOWED_CONTENT_TYPES) {
		// Match either an exact type or a typed-with-parameters value like 'text/xml; charset=utf-8'.
		// Reject prefix over-matches like 'application/xmlfoo'.
		if (lower === allowed || lower.startsWith(`${allowed};`) || lower.startsWith(`${allowed} `)) {
			return raw;
		}
	}
	return 'text/plain';
}

/**
 * Proxy API route to handle CORS issues with external resources
 * Fetches content from the URL provided in the 'url' query parameter
 * and returns it with appropriate CORS headers
 */
export async function GET(request: NextRequest): Promise<Response> {
	try {
		const limited = await enforceRateLimit(request, { name: 'proxy', windowMs: 60_000, max: 30 });
		if (limited) return limited;

		const { searchParams } = new URL(request.url);
		const url = searchParams.get('url');

		if (!url) {
			return NextResponse.json({ error: 'Missing URL parameter' }, { status: 400 });
		}

		let targetUrl: URL;
		try {
			targetUrl = new URL(url);
		} catch {
			return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
		}

		if (targetUrl.protocol !== 'https:') {
			return NextResponse.json({ error: 'Only HTTPS URLs are allowed' }, { status: 400 });
		}

		if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
			console.warn('[proxy] rejected host', targetUrl.hostname);
			return NextResponse.json({ error: 'Host not allowed' }, { status: 403 });
		}

		// Enforce standard HTTPS port and prevent access to services on other ports.
		if (targetUrl.port && targetUrl.port !== '443') {
			return NextResponse.json({ error: 'Only default HTTPS port 443 is allowed' }, { status: 400 });
		}

		// Basic path hardening: prevent path traversal and restrict to allowed prefixes.
		const pathname = targetUrl.pathname || '/';
		if (pathname.includes('..') || pathname.includes('\\')) {
			return NextResponse.json({ error: 'Path traversal is not allowed' }, { status: 400 });
		}
		if (!ALLOWED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
			console.warn('[proxy] rejected path', pathname);
			return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s for large GPX files

		const fetched = await fetchWithSizeCap(
			targetUrl.toString(),
			{
				headers: {
					Accept: 'application/xml, text/xml, */*',
					'User-Agent': 'Mozilla/5.0 (compatible; CLDT-Map/1.0; +https://github.com/cldt-hr/cldt-map)',
				},
				signal: controller.signal,
				// The host allowlist above is only checked for the requested URL. fetch() follows
				// redirects by default, so a redirect from the allowed host could escape the
				// allowlist and reflect arbitrary bytes to the client (this route serves the body
				// with a wildcard CORS header). Reject redirects instead: a 3xx lands in the
				// !response.ok branch of fetchWithSizeCap and is reported as an upstream error.
				redirect: 'manual',
			},
			MAX_BODY_BYTES,
		);

		clearTimeout(timeoutId);

		if (!fetched.ok) {
			return NextResponse.json({ error: fetched.reason }, { status: fetched.status });
		}

		return new NextResponse(fetched.body, {
			headers: {
				'Content-Type': sanitizeContentType(fetched.response.headers.get('Content-Type')),
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET',
				'Access-Control-Allow-Headers': 'Content-Type',
				'Cache-Control': 'public, max-age=86400',
			},
		});
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			return NextResponse.json({ error: 'Request timeout' }, { status: 504 });
		}
		console.error('[proxy]', error instanceof Error ? error.message : String(error));
		return NextResponse.json({ error: 'Failed to proxy request' }, { status: 500 });
	}
}
