import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/api-defense';
import {
	collectShareAllowedHosts,
	createShortShareLink,
	isShareShortenerConfigured,
	normalizeShareTarget,
	resolvePublicOrigin,
} from '@/lib/share-shortener-server';

interface ShareCreateBody {
	url?: unknown;
}

export async function POST(request: NextRequest): Promise<Response> {
	if (!isShareShortenerConfigured()) {
		return NextResponse.json({ error: 'Share shortener unavailable' }, { status: 503 });
	}

	const limited = enforceRateLimit(request, { name: 'share-create', windowMs: 3_600_000, max: 30 });
	if (limited) return limited;

	let body: ShareCreateBody;
	try {
		body = (await request.json()) as ShareCreateBody;
	} catch {
		return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (typeof body.url !== 'string' || body.url.length === 0) {
		return NextResponse.json({ error: 'Missing url' }, { status: 400 });
	}

	const target = normalizeShareTarget(body.url, collectShareAllowedHosts(request));
	if (!target) {
		return NextResponse.json({ error: 'URL is not an allowed share link' }, { status: 400 });
	}

	try {
		const created = await createShortShareLink(target);
		if (!created) {
			return NextResponse.json({ error: 'Could not allocate short code' }, { status: 503 });
		}

		const shortUrl = `${resolvePublicOrigin(request)}/s/${created.code}`;
		return NextResponse.json(
			{
				code: created.code,
				shortUrl,
				expiresAt: created.record.expiresAt,
			},
			{ status: 201 },
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes('Netlify Blobs') || message.includes('MissingBlobsEnvironment')) {
			return NextResponse.json({ error: 'Share shortener unavailable' }, { status: 503 });
		}
		console.error('share-create failed:', message);
		return NextResponse.json({ error: 'Internal error' }, { status: 500 });
	}
}
