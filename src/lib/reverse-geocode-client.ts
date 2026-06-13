'use client';

const sessionAddressCache = new Map<string, string | null>();
const sessionInFlight = new Map<string, Promise<string | null>>();

function cacheKey(lat: number, lng: number, locale: string): string {
	return `${lat.toFixed(4)},${lng.toFixed(4)},${locale}`;
}

/** Online reverse geocode for SOS display. Returns null when offline, failed, or empty. */
export async function fetchReverseGeocodeAddress(lat: number, lng: number, locale: string): Promise<string | null> {
	if (typeof navigator !== 'undefined' && !navigator.onLine) return null;

	const key = cacheKey(lat, lng, locale);
	const cached = sessionAddressCache.get(key);
	if (cached !== undefined) return cached;

	const pending = sessionInFlight.get(key);
	if (pending) return pending;

	const promise = (async (): Promise<string | null> => {
		try {
			const params = new URLSearchParams({
				lat: String(lat),
				lng: String(lng),
				locale,
			});
			const res = await fetch(`/api/reverse-geocode?${params.toString()}`);
			if (!res.ok) return null;
			const data = (await res.json()) as { address?: string | null };
			const line = typeof data.address === 'string' && data.address.length > 0 ? data.address : null;
			sessionAddressCache.set(key, line);
			return line;
		} catch {
			return null;
		} finally {
			sessionInFlight.delete(key);
		}
	})();

	sessionInFlight.set(key, promise);
	return promise;
}
