/**
 * Reverse geocode proxy for the SOS panel (Nominatim). Online only; coords are rounded before cache lookup.
 */
import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/api-defense';
import { reverseGeocodeAddress } from '@/lib/reverse-geocode-server';

function parseCoord(raw: string | null, min: number, max: number): number | null {
	if (raw === null) return null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < min || n > max) return null;
	return n;
}

export async function GET(request: NextRequest): Promise<Response> {
	const limited = enforceRateLimit(request, { name: 'reverse-geocode', windowMs: 3_600_000, max: 60 });
	if (limited) return limited;

	const { searchParams } = new URL(request.url);
	const lat = parseCoord(searchParams.get('lat'), -90, 90);
	const lng = parseCoord(searchParams.get('lng'), -180, 180);
	if (lat === null || lng === null) {
		return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 });
	}

	const locale = searchParams.get('locale') ?? 'en';

	try {
		const address = await reverseGeocodeAddress(lat, lng, locale);
		return NextResponse.json({ address });
	} catch (err) {
		console.error('reverse-geocode failed:', err instanceof Error ? err.message : String(err));
		return NextResponse.json({ address: null }, { status: 200 });
	}
}
