/**
 * Server-side Nominatim reverse geocoding for the SOS panel (import from API routes only).
 */
import { fetchWithSizeCap } from '@/lib/api-defense';
import { siteMetadata } from '@/lib/metadata';
import packageJson from '../../package.json';

const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = `CLDT-Map/${packageJson.version} (${siteMetadata.url}; ${siteMetadata.authorUrl})`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** A failed lookup (upstream error, oversized or unparseable reply) is retried after this. */
const FAILURE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const FETCH_TIMEOUT_MS = 8000;
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

/** Least recently used first: reads move an entry to the end, writes evict the front. */
const addressCache = new Map<string, CacheEntry>();

function readCache(key: string): CacheEntry | undefined {
	const entry = addressCache.get(key);
	if (!entry) return undefined;
	addressCache.delete(key);
	if (entry.expiresAt <= Date.now()) return undefined;
	addressCache.set(key, entry);
	return entry;
}

function writeCache(key: string, line: string | null, ttlMs: number): void {
	addressCache.delete(key);
	addressCache.set(key, { line, expiresAt: Date.now() + ttlMs });
	if (addressCache.size > MAX_CACHE_ENTRIES) {
		const oldest = addressCache.keys().next().value;
		if (oldest !== undefined) addressCache.delete(oldest);
	}
}

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
	const cached = readCache(key);
	if (cached) return cached.line;

	const params = new URLSearchParams({
		lat: String(lat),
		lon: String(lng),
		format: 'json',
		addressdetails: '1',
		zoom: '16',
	});
	const url = `${NOMINATIM_REVERSE}?${params.toString()}`;

	const fetched = await fetchWithSizeCap(
		url,
		{
			headers: { 'User-Agent': USER_AGENT, 'Accept-Language': lang },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			next: { revalidate: 86400 },
		},
		MAX_RESPONSE_BYTES,
	);
	if (!fetched.ok) {
		writeCache(key, null, FAILURE_TTL_MS);
		return null;
	}

	let data: NominatimReverseResponse;
	try {
		data = JSON.parse(fetched.body) as NominatimReverseResponse;
	} catch {
		writeCache(key, null, FAILURE_TTL_MS);
		return null;
	}

	const line = formatAddressFromNominatim(data);
	writeCache(key, line, CACHE_TTL_MS);
	return line;
}
