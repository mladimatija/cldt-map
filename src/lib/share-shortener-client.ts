'use client';

export interface ShortenShareUrlResult {
	url: string;
	short: boolean;
}

/** Ask the server to store a long share URL and return a compact `/s/{code}` link. */
export async function shortenShareUrl(longUrl: string): Promise<ShortenShareUrlResult> {
	try {
		const res = await fetch('/api/share', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: longUrl }),
		});
		if (!res.ok) {
			return { url: longUrl, short: false };
		}
		const data = (await res.json()) as { shortUrl?: string };
		if (typeof data.shortUrl === 'string' && data.shortUrl.length > 0) {
			return { url: data.shortUrl, short: true };
		}
		return { url: longUrl, short: false };
	} catch {
		return { url: longUrl, short: false };
	}
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
