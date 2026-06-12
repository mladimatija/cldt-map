import { NextRequest, NextResponse } from 'next/server';
import { isShareShortenerConfigured, resolveShortShareLink, SHARE_CODE_PATTERN } from '@/lib/share-shortener-server';

interface RouteContext {
	params: Promise<{ code: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
	const { code } = await context.params;
	if (!SHARE_CODE_PATTERN.test(code)) {
		return NextResponse.redirect(new URL('/', request.url));
	}

	if (!isShareShortenerConfigured()) {
		return NextResponse.redirect(new URL('/', request.url));
	}

	try {
		const result = await resolveShortShareLink(code);
		if (result === 'missing' || result === 'expired') {
			return NextResponse.redirect(new URL('/', request.url));
		}

		const destination = new URL(result.target, request.url);
		return NextResponse.redirect(destination, 302);
	} catch (err) {
		console.error('share-redirect failed:', err instanceof Error ? err.message : String(err));
		return NextResponse.redirect(new URL('/', request.url));
	}
}
