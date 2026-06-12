import { NextRequest, NextResponse } from 'next/server';
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
