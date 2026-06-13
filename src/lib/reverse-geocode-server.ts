/**
 * Server-side Nominatim reverse geocoding for the SOS panel (import from API routes only).
 */
import { siteMetadata } from '@/lib/metadata';

const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 32 * 1024;

interface NominatimAddressParts {
	road?: string;
	footway?: string;
	path?: string;
	hamlet?: string;
	village?: string;
	town?: string;
	city?: string;
	municipality?: string;
	county?: string;
	state?: string;
}

interface NominatimReverseResponse {
	display_name?: string;
	address?: NominatimAddressParts;
}

interface CacheEntry {
	line: string | null;
	expiresAt: number;
}

const addressCache = new Map<string, CacheEntry>();

function cacheKey(lat: number, lng: number, locale: string): string {
	return `${lat.toFixed(4)},${lng.toFixed(4)},${locale}`;
}

function formatAddressFromParts(address: NominatimAddressParts): string {
	const road = address.road ?? address.footway ?? address.path;
	const place =
		address.village ?? address.hamlet ?? address.town ?? address.city ?? address.municipality ?? address.county;
	const parts: string[] = [];
	if (road) parts.push(road);
	if (place) parts.push(place);
	else if (address.municipality && address.municipality !== place) parts.push(address.municipality);
	if (address.county && !parts.includes(address.county)) parts.push(address.county);
	return parts.join(', ');
}

function formatAddressFromNominatim(data: NominatimReverseResponse): string | null {
	const fromParts = data.address ? formatAddressFromParts(data.address) : '';
	if (fromParts.length > 0) return fromParts;
	const display = data.display_name?.trim();
	if (!display) return null;
	// Nominatim display_name can be very long; keep the first few comma-separated segments.
	const short = display
		.split(',')
		.slice(0, 4)
		.map((s) => s.trim())
		.filter(Boolean)
		.join(', ');
	return short || null;
}

function normalizeLocale(raw: string | null): string {
	if (!raw) return 'en';
	const base = raw.split('-')[0]?.toLowerCase() ?? 'en';
	if (base === 'hr' || base === 'de' || base === 'it' || base === 'en') return base;
	return 'en';
}

export async function reverseGeocodeAddress(lat: number, lng: number, locale: string): Promise<string | null> {
	const lang = normalizeLocale(locale);
	const key = cacheKey(lat, lng, lang);
	const cached = addressCache.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached.line;

	const params = new URLSearchParams({
		lat: String(lat),
		lon: String(lng),
		format: 'json',
		addressdetails: '1',
		zoom: '16',
	});
	const url = `${NOMINATIM_REVERSE}?${params.toString()}`;

	const res = await fetch(url, {
		headers: {
			'User-Agent': `CLDT-Map/1.8 (${siteMetadata.url}; ${siteMetadata.authorUrl})`,
			'Accept-Language': lang,
		},
		next: { revalidate: 86400 },
	});

	if (!res.ok) {
		addressCache.set(key, { line: null, expiresAt: Date.now() + 5 * 60 * 1000 });
		return null;
	}

	const text = await res.text();
	if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) {
		return null;
	}

	let data: NominatimReverseResponse;
	try {
		data = JSON.parse(text) as NominatimReverseResponse;
	} catch {
		return null;
	}

	const line = formatAddressFromNominatim(data);
	addressCache.set(key, { line, expiresAt: Date.now() + CACHE_TTL_MS });
	return line;
}
