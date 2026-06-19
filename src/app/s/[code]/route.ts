import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/api-defense';
import {
	isShareShortenerConfigured,
	resolvePublicOrigin,
	resolveShortShareLink,
	SHARE_CODE_PATTERN,
} from '@/lib/share-shortener-server';

interface RouteContext {
	params: Promise<{ code: string }>;
}

function redirectToHome(request: NextRequest): NextResponse {
	return NextResponse.redirect(new URL('/', resolvePublicOrigin(request)), 302);
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
	const { code } = await context.params;
	if (!SHARE_CODE_PATTERN.test(code)) {
		return redirectToHome(request);
	}

	// Per-IP cap on the public redirect to blunt enumeration of random codes
	// (each miss still hits Netlify Blobs). The create endpoint is limited too.
	const limited = await enforceRateLimit(request, { name: 'share-redirect', windowMs: 60_000, max: 60 });
	if (limited) return limited;

	if (!isShareShortenerConfigured()) {
		return redirectToHome(request);
	}

	try {
		const result = await resolveShortShareLink(code);
		if (result === 'missing' || result === 'expired') {
			return redirectToHome(request);
		}

		const destination = new URL(result.target, resolvePublicOrigin(request));
		return NextResponse.redirect(destination, 302);
	} catch (err) {
		console.error('share-redirect failed:', err instanceof Error ? err.message : String(err));
		return redirectToHome(request);
	}
}
