/**
 * Next.js middleware: runs next-intl locale routing and injects CSP + nonce into requests.
 * Ex-Yu Accept-Language codes default to Croatian; others to English.
 */
import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { routing } from './i18n/routing';

/** Ex-Yu language codes (former Yugoslavia): default to Croatian when no cookie/locale set. */
const EX_YU_LANGUAGE_CODES = ['hr', 'sr', 'sl', 'bs', 'mk', 'sq', 'cnr'];

function getDefaultLocaleFromRequest(request: NextRequest): 'en' | 'hr' {
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
	// In dev, omit nonce from style-src so 'unsafe-inline' applies and Next.js dev overlay (bottom-left logo) can use inline styles
	const styleSrc = isDev ? "'self' 'unsafe-inline'" : `'self' 'nonce-${nonce}'`;
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

export default function proxy(request: NextRequest): ReturnType<ReturnType<typeof createMiddleware>> {
	const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
	const cspHeader = buildCspHeader(nonce);

	const requestHeaders = new Headers(request.headers);
	requestHeaders.set('x-nonce', nonce);
	requestHeaders.set('Content-Security-Policy', cspHeader);

	const requestWithNonce = new NextRequest(request.url, {
		headers: requestHeaders,
		method: request.method,
	});

	const defaultLocale = getDefaultLocaleFromRequest(request);
	const handleI18nRouting = createMiddleware({
		...routing,
		defaultLocale,
	});
	const response = handleI18nRouting(requestWithNonce);
	response.headers.set('Content-Security-Policy', cspHeader);
	return response;
}

/** Only run middleware on page routes; skip /_next, /api, and static files so they are served correctly. */
export const config = {
	matcher: ['/((?!api|trpc|_next|_vercel|.*\\..*).*)'],
};
