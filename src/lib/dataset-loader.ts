/**
 * Loader for the datasets that ship as a static file and may be overridden by
 * a remote URL (POIs, seasonal status, notices, OSM tags, junctions, mine
 * areas). One loader per dataset keeps the result for the page; after reset()
 * the next load revalidates and hands back the cached object when nothing
 * changed, so the stores (and everything keyed on the dataset's identity) see
 * no update.
 *
 * Sources are tried in order: the remote override (https only), then the
 * bundled file. A source that fails (network, HTTP error, invalid JSON, or a
 * payload `normalize` rejects) falls through to the next. When every source
 * fails on a revalidation, the last good dataset is returned, so going offline
 * never blanks a layer that was showing; when nothing has loaded yet, the null
 * result is not kept, so the next load tries again.
 *
 * Unchanged data is recognised three ways: a 304 for the bundled file (it is
 * sent If-None-Match; a cross-origin override is not, as that header would
 * need a CORS preflight), a 200 carrying the cached ETag (the service worker's
 * offline copy), and a body with the same length and hash (a remote without a
 * readable ETag, or one whose ETag changes per edge or encoding).
 */
import { isHttpsUrl } from './feed-validation';

export interface DatasetLoaderOptions<T> {
	/** Remote override, e.g. a NEXT_PUBLIC_*_URL; ignored unless https. */
	remoteUrl?: string;
	/** Same-origin path of the bundled copy. */
	localPath: string;
	/** Validates and shapes the parsed JSON; null rejects the payload. */
	normalize: (raw: unknown) => T | null;
}

export interface DatasetLoader<T> {
	/** The dataset for this page: cached, or fetched when there is none yet or reset() ran. */
	load: () => Promise<T | null>;
	/** Marks the dataset stale, so the next load revalidates. */
	reset: () => void;
}

interface SourceCache<T> {
	data: T;
	etag: string | null;
	/** Length and hash of the body the data was parsed from. */
	digest: string;
}

/** Length plus a 32-bit FNV-1a hash of the body: enough to tell an unchanged
 *  reply from a new one without keeping the (multi-MB) text. */
function bodyDigest(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return `${text.length}:${(hash >>> 0).toString(36)}`;
}

export function createDatasetLoader<T>({ remoteUrl, localPath, normalize }: DatasetLoaderOptions<T>): DatasetLoader<T> {
	const sources = isHttpsUrl(remoteUrl) ? [remoteUrl, localPath] : [localPath];
	const cache = new Map<string, SourceCache<T>>();
	let lastGood: T | null = null;
	let pending: Promise<T | null> | null = null;

	const fetchSource = async (url: string): Promise<T | null> => {
		const cached = cache.get(url);
		const sameOrigin = url.startsWith('/');
		const res = await fetch(
			url,
			sameOrigin && cached?.etag ? { headers: { 'If-None-Match': cached.etag } } : undefined,
		);
		if (res.status === 304 && cached) return cached.data;
		if (!res.ok) return null;
		const etag = res.headers.get('etag');
		if (cached && etag !== null && etag === cached.etag) return cached.data;
		const text = await res.text();
		const digest = bodyDigest(text);
		if (cached?.digest === digest) {
			cached.etag = etag;
			return cached.data;
		}
		const data = normalize(JSON.parse(text) as unknown);
		if (data !== null) cache.set(url, { data, etag, digest });
		return data;
	};

	const fetchDataset = async (): Promise<T | null> => {
		for (const url of sources) {
			try {
				const data = await fetchSource(url);
				if (data !== null) {
					lastGood = data;
					return data;
				}
			} catch {
				// Network failure or invalid JSON: try the next source.
			}
		}
		return lastGood;
	};

	return {
		load: () => {
			if (!pending) {
				const attempt: Promise<T | null> = fetchDataset().then((data) => {
					// Nothing loaded: let the next call try again (unless reset() already
					// started a newer attempt).
					if (data === null && pending === attempt) pending = null;
					return data;
				});
				pending = attempt;
			}
			return pending;
		},
		reset: () => {
			pending = null;
		},
	};
}
