import { isSafeUrl } from '@/lib/utils';
import { matchCachedAsset } from '@/lib/poi-prefetch';

/**
 * Lightweight Wikipedia REST summary fetcher used by POI popups to render a
 * one-paragraph snippet alongside the curated POI fields.
 *
 * The dataset stores Wikipedia references in one of two forms:
 *   - "Zagreb"        (bare article title; English Wikipedia assumed)
 *   - "hr:Velebit"    (locale-prefixed; uses the matching language wiki)
 *
 * Results are cached in-memory per session so re-opening the same popup
 * never re-fetches. Failures (network, 404, blocked) are also cached as
 * `null` to avoid retry storms on every popup open.
 */

export const SUMMARY_HOST_TEMPLATE = 'https://{locale}.wikipedia.org/api/rest_v1/page/summary/';
const DEFAULT_LOCALE = 'en';

/** Maximum number of Wikipedia summaries kept in the per-session cache. Capped
 *  at 500 to bound memory usage: with ~8k POIs the theoretical maximum is high,
 *  but practical sessions open far fewer popups; 500 is generous enough to
 *  cover power users while preventing unbounded growth. LRU eviction (delete-
 *  then-re-set on read; evict oldest key on write when over limit) keeps the
 *  most-recently-used entries warm. */
const CACHE_MAX_ENTRIES = 500;

/** Max length of a Wikipedia URL we will accept from the API response. The
 *  read-side already calls `isSafeUrl` before assigning to an anchor href; a
 *  hard upper bound on length stops a hostile or accidentally-huge response
 *  from being kept in memory before that guard runs. */
const WIKIPEDIA_URL_MAX_LEN = 2048;

/** Per-session LRU cache keyed by `{locale}:{title}`. `null` means "tried,
 *  no result"; absent means "never tried". Map iteration is insertion-order,
 *  so deleting and re-setting on read promotes the key to most-recent and the
 *  oldest entry is the iterator's first key when we need to evict. */
const cache = new Map<string, WikipediaSummary | null>();

function cacheGet(key: string): WikipediaSummary | null | undefined {
	if (!cache.has(key)) return undefined;
	const value = cache.get(key) ?? null;
	// Promote to most-recently-used.
	cache.delete(key);
	cache.set(key, value);
	return value;
}

function cacheSet(key: string, value: WikipediaSummary | null): void {
	if (cache.has(key)) cache.delete(key);
	cache.set(key, value);
	if (cache.size > CACHE_MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
}

export interface WikipediaSummary {
	title: string;
	extract: string;
	url: string;
	thumbnailUrl?: string;
}

interface WikipediaRef {
	locale: string;
	title: string;
}

/** Parse a Wikipedia reference into a `{locale, title}` pair. Accepts three
 *  forms:
 *    - Full URL:         "https://hr.wikipedia.org/wiki/Velebit" -> {locale:"hr", title:"Velebit"}
 *    - Locale-prefixed:  "hr:Velebit" -> {locale:"hr", title:"Velebit"}
 *    - Bare title:       "Velebit" -> {locale:"en", title:"Velebit"} (English assumed)
 *
 *  The locale segment must be a 2 or 3 character ISO 639 language code; anything
 *  else is treated as part of the title (avoids misparsing titles that contain
 *  colons).
 *
 *  Full URL support ensures that dataset entries produced by the enricher (which
 *  may store full Wikipedia URLs) are parsed consistently with the short-form
 *  references. */
export function parseWikipediaRef(raw: string): WikipediaRef | null {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;
	// Full URL: extract locale + title from the hostname and path.
	if (/^https?:\/\//i.test(trimmed)) {
		try {
			const u = new URL(trimmed);
			const m = u.hostname.match(/^([a-z]{2,3})\.wikipedia\.org$/);
			if (m && u.pathname.startsWith('/wiki/')) {
				return { locale: m[1], title: decodeURIComponent(u.pathname.slice('/wiki/'.length)) };
			}
		} catch {
			// fall through
		}
		return null;
	}
	const colonIdx = trimmed.indexOf(':');
	// Accept 2-3 char ISO 639 language codes (colonIdx 2 or 3, e.g. "hr", "en", "gsw").
	// Reject 0-1 (too short - empty prefix or single char, neither is a valid BCP-47 tag)
	// and 4+ (not a valid language tag - treat the whole string as a bare title).
	if (colonIdx >= 2 && colonIdx <= 3) {
		const maybeLocale = trimmed.slice(0, colonIdx).toLowerCase();
		const rest = trimmed.slice(colonIdx + 1).trim();
		if (/^[a-z]{2,3}$/.test(maybeLocale) && rest.length > 0) {
			return { locale: maybeLocale, title: rest };
		}
	}
	return { locale: DEFAULT_LOCALE, title: trimmed };
}

/** Truncate at the nearest sentence boundary under `maxLen` chars; fall back
 *  to a hard cut with an ellipsis if no sentence boundary is found. Wikipedia
 *  summaries are usually 1-3 sentences so this rarely truncates aggressively. */
export function truncateExtract(extract: string, maxLen = 240): string {
	if (extract.length <= maxLen) return extract;
	const slice = extract.slice(0, maxLen);
	const lastPeriod = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
	if (lastPeriod > maxLen * 0.5) return slice.slice(0, lastPeriod + 1);
	return slice.trimEnd() + '...';
}

/**
 * Fetches a Wikipedia summary for the given reference, returning a normalised
 * shape or `null` on any failure. Reads / writes the per-session cache so
 * repeated calls are free.
 */
export async function fetchWikipediaSummary(rawRef: string): Promise<WikipediaSummary | null> {
	const parsed = parseWikipediaRef(rawRef);
	if (!parsed) return null;
	const cacheKey = `${parsed.locale}:${parsed.title}`;
	const cached = cacheGet(cacheKey);
	if (cached !== undefined) return cached;

	const url = SUMMARY_HOST_TEMPLATE.replace('{locale}', parsed.locale) + encodeURIComponent(parsed.title);
	if (!isSafeUrl(url)) {
		cacheSet(cacheKey, null);
		return null;
	}

	try {
		// Try the offline POI prefetch cache first - lets popups open offline
		// for any POI whose corridor has been pre-cached. Falls through to a
		// live network fetch on miss.
		let res: Response | null = await matchCachedAsset(url);
		if (!res) {
			res = await fetch(url, { headers: { Accept: 'application/json' } });
		}
		if (!res.ok) {
			cacheSet(cacheKey, null);
			return null;
		}
		const json = (await res.json()) as {
			title?: string;
			extract?: string;
			content_urls?: { desktop?: { page?: string } };
			thumbnail?: { source?: string };
		};
		if (!json.extract || !json.title) {
			cacheSet(cacheKey, null);
			return null;
		}
		// Cap the response URL length and run isSafeUrl on every URL the
		// response surfaces before storing them - belt-and-suspenders for the
		// guards the consumer already applies, so a hostile or accidentally-
		// huge value never lives in the cache.
		const rawSummaryUrl = json.content_urls?.desktop?.page;
		const summaryUrl =
			rawSummaryUrl && rawSummaryUrl.length <= WIKIPEDIA_URL_MAX_LEN && isSafeUrl(rawSummaryUrl) ? rawSummaryUrl : url;
		const rawThumbnailUrl = json.thumbnail?.source;
		const thumbnailUrl =
			rawThumbnailUrl && rawThumbnailUrl.length <= WIKIPEDIA_URL_MAX_LEN && isSafeUrl(rawThumbnailUrl)
				? rawThumbnailUrl
				: undefined;
		const summary: WikipediaSummary = {
			title: json.title.slice(0, 256),
			extract: json.extract,
			url: summaryUrl,
			thumbnailUrl,
		};
		cacheSet(cacheKey, summary);
		return summary;
	} catch {
		cacheSet(cacheKey, null);
		return null;
	}
}
