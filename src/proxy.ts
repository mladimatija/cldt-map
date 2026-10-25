/**
 * Next.js middleware: runs next-intl locale routing and injects CSP + nonce into requests.
 * Ex-Yu Accept-Language codes default to Croatian; others to English.
 */
import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing, type Locale } from './i18n/routing';

/** Ex-Yu language codes (former Yugoslavia): default to Croatian when no cookie/locale set. */
const EX_YU_LANGUAGE_CODES = ['hr', 'sr', 'sl', 'bs', 'mk', 'sq', 'cnr'];

function getDefaultLocaleFromRequest(request: NextRequest): Extract<Locale, 'en' | 'hr'> {
	const acceptLanguage = request.headers.get('accept-language') || '';
	const parts = acceptLanguage.split(',').map((p) => p.trim().split(';')[0]);
	for (const part of parts) {
		const lang = part.split('-')[0].toLowerCase();
		if (EX_YU_LANGUAGE_CODES.includes(lang)) {
			return 'hr';
		}
	}
	return 'en';
}

function buildCspHeader(nonce: string): string {
	const isDev = process.env.NODE_ENV === 'development';
	// style-src allows inline styles in every environment: Leaflet divIcon markers
	// (POI dots, clusters, seasonal chips, stage boundaries, sunset discs) carry
	// per-marker style attributes that a nonce can never cover, and CSP ignores
	// 'unsafe-inline' whenever a nonce is present in the directive - so the nonce
	// must stay out of style-src or every marker style gets blocked (seen in prod
	// as colorless POI markers and invisible seasonal chips). Style injection is
	// an accepted, low-risk trade-off; script-src keeps the nonce + strict-dynamic,
	// which is the security-critical part.
	const styleSrc = "'self' 'unsafe-inline'";
	return [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
		`style-src ${styleSrc}`,
		"img-src 'self' data: https: blob:",
		"font-src 'self' data: https://fonts.gstatic.com",
		"connect-src 'self' https:",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	].join('; ');
}

/** Locale routing per default locale, built once rather than on every request:
 *  the default is the only part that varies, and it is either en or hr. */
const I18N_ROUTING = {
	en: createMiddleware({ ...routing, defaultLocale: 'en' }),
	hr: createMiddleware({ ...routing, defaultLocale: 'hr' }),
};

export default function proxy(request: NextRequest): ReturnType<ReturnType<typeof createMiddleware>> {
	const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
	const cspHeader = buildCspHeader(nonce);

	const requestHeaders = new Headers(request.headers);
	requestHeaders.set('x-nonce', nonce);
	requestHeaders.set('Content-Security-Policy', cspHeader);

	// The offline fallback lives outside the locale tree (the service worker
	// precaches it and it picks its language on the client); locale routing would
	// rewrite it to a page that does not exist.
	if (request.nextUrl.pathname === '/offline') {
		const response = NextResponse.next({ request: { headers: requestHeaders } });
		response.headers.set('Content-Security-Policy', cspHeader);
		return response;
	}

	const requestWithNonce = new NextRequest(request.url, {
		headers: requestHeaders,
		method: request.method,
	});

	const response = I18N_ROUTING[getDefaultLocaleFromRequest(request)](requestWithNonce);
	response.headers.set('Content-Security-Policy', cspHeader);
	return response;
}

/** Only run middleware on page routes; skip /_next, /api, /s short links, and static files. */
export const config = {
	matcher: ['/((?!api|s/|trpc|_next|_vercel|.*\\..*).*)'],
};
