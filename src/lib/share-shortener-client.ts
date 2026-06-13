'use client';

export interface ShortenShareUrlResult {
	url: string;
	short: boolean;
}

/** Successful short links for this tab, keyed by the long URL passed to the API. */
const sessionShortUrlCache = new Map<string, ShortenShareUrlResult>();
/** In-flight POST dedup so panel open + copy do not race two creates for the same URL. */
const sessionShortUrlInFlight = new Map<string, Promise<ShortenShareUrlResult>>();

/** Ask the server to store a long share URL and return a compact `/s/{code}` link. */
export async function shortenShareUrl(longUrl: string): Promise<ShortenShareUrlResult> {
	const cached = sessionShortUrlCache.get(longUrl);
	if (cached) return cached;

	const pending = sessionShortUrlInFlight.get(longUrl);
	if (pending) return pending;

	const promise = (async (): Promise<ShortenShareUrlResult> => {
		try {
			const res = await fetch('/api/share', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: longUrl }),
			});
			if (!res.ok) {
				const result = { url: longUrl, short: false as const };
				sessionShortUrlCache.set(longUrl, result);
				return result;
			}
			const data = (await res.json()) as { shortUrl?: string };
			if (typeof data.shortUrl === 'string' && data.shortUrl.length > 0) {
				const result = { url: data.shortUrl, short: true as const };
				sessionShortUrlCache.set(longUrl, result);
				return result;
			}
			const fallback = { url: longUrl, short: false as const };
			sessionShortUrlCache.set(longUrl, fallback);
			return fallback;
		} catch {
			const fallback = { url: longUrl, short: false as const };
			sessionShortUrlCache.set(longUrl, fallback);
			return fallback;
		} finally {
			sessionShortUrlInFlight.delete(longUrl);
		}
	})();

	sessionShortUrlInFlight.set(longUrl, promise);
	return promise;
}

/** Resolve a share URL according to user preference and connectivity. */
export async function resolveShareUrlForCopy(
	longUrl: string,
	options: { useShortLinks: boolean; online: boolean },
): Promise<ShortenShareUrlResult> {
	if (!options.useShortLinks || !options.online) {
		return { url: longUrl, short: false };
	}
	return shortenShareUrl(longUrl);
}
