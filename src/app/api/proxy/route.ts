/**
 * Server-side proxy for GPX and other external resources. Used to avoid CORS when fetching from cldt.hr.
 * Only allows ALLOWED_HOSTS; rejects non-HTTPS and invalid URLs.
 */
import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_HOSTS = ['cldt.hr', 'www.cldt.hr'];
const ALLOWED_PATH_PREFIXES = ['/']; // Adjust to more specific prefixes (e.g. ['/gpx/', '/maps/']) as needed.

/**
 * Proxy API route to handle CORS issues with external resources
 * Fetches content from the URL provided in the 'url' query parameter
 * and returns it with appropriate CORS headers
 */
export async function GET(request: NextRequest): Promise<Response> {
	try {
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
			return NextResponse.json({ error: `Host not allowed: ${targetUrl.hostname}` }, { status: 403 });
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
			return NextResponse.json({ error: `Path not allowed: ${pathname}` }, { status: 403 });
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s for large GPX files

		const response = await fetch(targetUrl.toString(), {
			headers: {
				Accept: 'application/xml, text/xml, */*',
				'User-Agent': 'Mozilla/5.0 (compatible; CLDT-Map/1.0; +https://github.com/cldt-hr/cldt-map)',
			},
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			return NextResponse.json(
				{ error: `Upstream error: ${response.status} ${response.statusText}` },
				{ status: response.status },
			);
		}

		const content = await response.text();

		return new NextResponse(content, {
			headers: {
				'Content-Type': response.headers.get('Content-Type') || 'text/xml',
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
		console.error('Proxy error:', error);
		return NextResponse.json({ error: 'Failed to proxy request' }, { status: 500 });
	}
}
