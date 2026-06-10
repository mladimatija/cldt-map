import { isSafeUrl } from '@/lib/utils';
// Single import surface for the leaf type module: brings the symbols into
// local scope for use in function signatures below AND lets us re-export
// them so existing call sites that import from '@/lib/pois' continue to work.
import {
	KNOWN_POI_TYPES,
	POI_TYPE_GROUPS,
	isKnownType,
	STAGE_POI_OFFTRAIL_KM,
	type KnownPoiType,
	type Poi,
	type PoiImage,
	type PoiType,
	type PoisFile,
} from './poi-types';
export { KNOWN_POI_TYPES, POI_TYPE_GROUPS, isKnownType, STAGE_POI_OFFTRAIL_KM };
export type { KnownPoiType, Poi, PoiImage, PoiType, PoisFile };

let cachedPromise: Promise<PoisFile | null> | null = null;

/** ETag value from the most recent successful /pois.json response. Used to
 *  send If-None-Match on the next refetch so a 304 response skips the ~2.7 MB
 *  JSON parse entirely. `null` when no ETag was received (e.g. dev server or
 *  custom remote URL that omits the header) - falls back to full re-parse. */
let cachedEtag: string | null = null;

/** Last successfully parsed POI dataset. Kept alongside the promise so that a
 *  304 Not Modified response can return the already-parsed result immediately
 *  without re-parsing the JSON body. */
let lastParsedResult: PoisFile | null = null;

// ── Per-type split loading ────────────────────────────────────────────────────
//
// scripts/split-pois.mjs (npm prebuild) derives /data/pois/<type>.json from
// the committed pois.json. Loading per type means a user who disabled peaks
// skips the 1.4 MB peak file entirely, and each file revalidates with its own
// ETag. When the split files are unavailable (plain `next dev`, or a custom
// NEXT_PUBLIC_POIS_URL which is whole-file by definition), everything falls
// back to the legacy whole-file path below.

interface TypeCacheEntry {
	etag: string | null;
	data: PoisFile | null;
	/** False after resetPoisCache(): the next load revalidates (304 reuses data). */
	validated: boolean;
	inflight: Promise<PoisFile | null> | null;
}

const typeCache = new Map<string, TypeCacheEntry>();
/** Sticky once a per-type file is missing or a remote override is configured. */
let splitUnavailable = !!process.env.NEXT_PUBLIC_POIS_URL;
/** Memo of the last merge so repeat calls with the same inputs keep object
 *  identity (consumers memo on the file reference). */
let lastMergeKey: string | null = null;
let lastMergeInputs: (PoisFile | null)[] = [];
let lastMergeResult: PoisFile | null = null;

function entryFor(type: string): TypeCacheEntry {
	let e = typeCache.get(type);
	if (!e) {
		e = { etag: null, data: null, validated: false, inflight: null };
		typeCache.set(type, e);
	}
	return e;
}

async function fetchPoiType(type: string): Promise<PoisFile | null> {
	const entry = entryFor(type);
	try {
		const headers: HeadersInit = entry.etag ? { 'If-None-Match': entry.etag } : {};
		const res = await fetch(`/data/pois/${encodeURIComponent(type)}.json`, { headers });
		if (res.status === 304 && entry.data !== null) {
			entry.validated = true;
			return entry.data;
		}
		if (res.ok) {
			entry.etag = res.headers.get('etag');
			const parsed = normalize((await res.json()) as Partial<PoisFile>);
			entry.data = parsed;
			entry.validated = true;
			return parsed;
		}
		// 404 and friends: the split was not generated for this deployment.
		splitUnavailable = true;
		return null;
	} catch {
		// Network failure: keep whatever we had; do not mark the split missing.
		return entry.data;
	}
}

function loadPoiType(type: string): Promise<PoisFile | null> {
	const entry = entryFor(type);
	if (entry.validated && entry.data !== null) return Promise.resolve(entry.data);
	if (entry.inflight) return entry.inflight;
	entry.inflight = fetchPoiType(type).finally(() => {
		entry.inflight = null;
	});
	return entry.inflight;
}

function mergeTypeFiles(key: string, files: (PoisFile | null)[]): PoisFile {
	if (
		lastMergeResult &&
		lastMergeKey === key &&
		lastMergeInputs.length === files.length &&
		lastMergeInputs.every((f, i) => f === files[i])
	) {
		return lastMergeResult;
	}
	const pois: Poi[] = [];
	let lastUpdated = '';
	for (const f of files) {
		if (!f) continue;
		pois.push(...f.pois);
		if (f.lastUpdated > lastUpdated) lastUpdated = f.lastUpdated;
	}
	pois.sort((a, b) => a.trailKm - b.trailKm);
	lastMergeKey = key;
	lastMergeInputs = files;
	lastMergeResult = { lastUpdated, pois };
	return lastMergeResult;
}

/**
 * Loads the POI dataset. With `types` given, fetches only those per-type
 * files (the map flow passes the user's enabled types); without arguments,
 * loads every known type (prefetch / trip-brief / planner paths). Falls back
 * to the legacy whole-file /pois.json when the split is unavailable; in that
 * case an explicit `types` set is filtered from the whole file so callers
 * see identical shapes either way.
 *
 * Caches for the lifetime of the page; call resetPoisCache() to force
 * revalidation (per-file ETags make that cheap).
 */
export async function loadPois(types?: ReadonlySet<string>): Promise<PoisFile | null> {
	const requested: string[] = types ? [...types].filter(isKnownType).sort() : [...KNOWN_POI_TYPES].sort();
	if (requested.length === 0) return { lastUpdated: '', pois: [] };

	if (!splitUnavailable) {
		const files = await Promise.all(requested.map((t) => loadPoiType(t)));
		// fetchPoiType flips splitUnavailable on 404; detect and fall through.
		if (!splitUnavailable) {
			return mergeTypeFiles(requested.join(','), files);
		}
	}

	if (!cachedPromise) cachedPromise = fetchPois();
	const whole = await cachedPromise;
	if (!whole) return null;
	if (!types) return whole;
	const enabled = new Set(requested);
	return { lastUpdated: whole.lastUpdated, pois: whole.pois.filter((p) => enabled.has(p.type)) };
}

export function resetPoisCache(): void {
	cachedPromise = null;
	for (const entry of typeCache.values()) {
		entry.validated = false;
	}
	lastMergeKey = null;
	lastMergeInputs = [];
	lastMergeResult = null;
}

/**
 * Fetches the POI dataset. Tries the remote URL first (NEXT_PUBLIC_POIS_URL),
 * then falls back to the bundled /pois.json.
 *
 * Security note: /pois.json is the trusted bundled fallback. It is generated
 * by scripts/enrich-pois.ts (the source of truth) and reviewed before each
 * commit - it is not fetched from an untrusted origin. The normalise() and
 * isValidPoi() guards still run on the parsed result to enforce schema
 * constraints regardless of which source is used.
 */
async function fetchPois(): Promise<PoisFile | null> {
	const remoteUrl = process.env.NEXT_PUBLIC_POIS_URL;
	// Match the stricter https-only allow-list used for poi.url in PoiMarkers
	// so the dataset surfaced to every user can't ride a plain-HTTP request.
	if (remoteUrl && isSafeUrl(remoteUrl) && remoteUrl.startsWith('https://')) {
		try {
			const res = await fetch(remoteUrl);
			if (res.ok) {
				const result = normalize((await res.json()) as Partial<PoisFile>);
				lastParsedResult = result;
				return result;
			}
		} catch {
			// fall through to bundled
		}
	}
	try {
		// Include If-None-Match when we have a cached ETag from a previous fetch
		// of /pois.json. A 304 Not Modified response means the file is unchanged
		// so we can skip the ~2.7 MB JSON parse and return the last result as-is.
		// The ETag is absent in the Next.js dev server but reliably present for
		// static files under /public in production builds. If the header is
		// absent we simply fall through to a normal parse.
		const headers: HeadersInit = cachedEtag ? { 'If-None-Match': cachedEtag } : {};
		const res = await fetch('/pois.json', { headers });

		if (res.status === 304 && lastParsedResult !== null) {
			// Server confirmed the file is unchanged - reuse the already-parsed data.
			return lastParsedResult;
		}

		if (res.ok) {
			const etag = res.headers.get('etag');
			if (etag) cachedEtag = etag;
			const result = normalize((await res.json()) as Partial<PoisFile>);
			lastParsedResult = result;
			return result;
		}
	} catch {
		// ignore
	}
	return null;
}

/** Defensive guards mirroring the trail-osm-tags loader: refuse implausibly
 *  large payloads and refuse malformed entries rather than crashing.
 *
 *  10,000 is well above the current dataset size (~8k rows now that the
 *  enricher covers all 10 POI types) but well under any plausible
 *  "something went very wrong" upload. Bumped from 5,000 once the food
 *  + ATM types pushed the real dataset past that ceiling. */
const MAX_POIS = 10000;
const MAX_NAME_LEN = 128;

/** Peaks beyond this corridor are filtered at load time: 2 km is roughly the
 *  side-trip budget for a hiker, and the wider dataset is dominated by minor
 *  summits that clutter the map without being useful to a CLDT walker. */
const MAX_PEAK_OFFTRAIL_KM = 2;

/** Character whitelist for POI ids. Mirrors the read-side `POI_ID_RE` in
 *  utils.ts so ingestion and URL parsing agree on what a valid id looks like.
 *  Also closes the CSS-selector injection vector in PoiMarkers.tsx by
 *  ensuring ids never contain unescaped CSS special characters. */
const POI_ID_VALID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function isValidPoi(p: unknown): p is Poi {
	if (!p || typeof p !== 'object') return false;
	const o = p as Record<string, unknown>;
	return (
		typeof o.id === 'string' &&
		POI_ID_VALID_RE.test(o.id) &&
		typeof o.type === 'string' &&
		typeof o.name_en === 'string' &&
		o.name_en.length <= MAX_NAME_LEN &&
		typeof o.name_hr === 'string' &&
		o.name_hr.length <= MAX_NAME_LEN &&
		Number.isFinite(o.lat) &&
		Number.isFinite(o.lng) &&
		Number.isFinite(o.trailKm) &&
		Number.isFinite(o.distanceFromTrailKm)
	);
}

function normalize(raw: Partial<PoisFile>): PoisFile | null {
	if (!raw || typeof raw !== 'object') return null;
	if (!Array.isArray(raw.pois)) return null;
	if (raw.pois.length > MAX_POIS) {
		// Surface so this never silently hides the entire POI feature again -
		// MAX_POIS=5000 used to fail this way until the dataset grew past it.
		console.warn(`pois.json has ${raw.pois.length} rows, exceeds MAX_POIS=${MAX_POIS}; rejecting payload.`);
		return null;
	}
	const validPois = raw.pois
		.filter(isValidPoi)
		.filter((p) => p.type !== 'peak' || p.distanceFromTrailKm <= MAX_PEAK_OFFTRAIL_KM);
	const dropped = raw.pois.length - validPois.length;
	if (dropped > 0) {
		console.warn(
			`pois.json: dropped ${dropped} invalid POI entr${dropped === 1 ? 'y' : 'ies'} (failed isValidPoi check).`,
		);
	}
	return { lastUpdated: raw.lastUpdated ?? '', pois: validPois };
}

/** Buckets a flat POI list by type. Useful for per-type rendering / toggles. */
export function bucketByType(pois: Poi[]): Map<PoiType, Poi[]> {
	const out = new Map<PoiType, Poi[]>();
	for (const p of pois) {
		const list = out.get(p.type) ?? [];
		list.push(p);
		out.set(p.type, list);
	}
	return out;
}

/** Case-insensitive substring match against name_en and name_hr. Diacritics
 *  are folded so a search for "Cakovec" matches "Čakovec" and "Đakovo"
 *  matches "Djakovo". Returns matches in the original order; callers can
 *  sort by trailKm or distanceFromTrailKm if needed. */
export function searchPoisByName(pois: Poi[], query: string, limit = 20): Poi[] {
	const q = foldDiacritics(query.trim().toLowerCase());
	if (q.length === 0) return [];
	const matches: Poi[] = [];
	for (const p of pois) {
		const en = foldDiacritics(p.name_en.toLowerCase());
		const hr = foldDiacritics(p.name_hr.toLowerCase());
		if (en.includes(q) || hr.includes(q)) {
			matches.push(p);
			if (matches.length >= limit) break;
		}
	}
	return matches;
}

/** Fold Croatian diacritics so a user can type ascii and still match
 *  diacritic-bearing place names. Keeping the mapping local rather than
 *  pulling Intl.Collator since the diacritic set in CLDT-region names is
 *  small and well-known. Both lowercase and uppercase variants are handled
 *  so callers are not required to lowercase the input first.
 *
 *  Single-regex pass with a lookup table: reduces intermediate string
 *  allocations from 4 per call to 1, which matters on the debounced search
 *  path that runs over all ~8k POI names per keystroke. */
const DIACRITIC_FOLD_MAP: Record<string, string> = {
	č: 'c',
	ć: 'c',
	Č: 'c',
	Ć: 'c',
	š: 's',
	Š: 's',
	ž: 'z',
	Ž: 'z',
	đ: 'dj',
	Đ: 'dj',
};
export function foldDiacritics(s: string): string {
	return s.replace(/[čćČĆšŠžŽđĐ]/g, (c) => DIACRITIC_FOLD_MAP[c] ?? c);
}

/** Localised display name picker. Falls back to name_en if the locale entry
 *  is missing (defensive against partially-translated datasets). */
export function poiDisplayName(p: Poi, locale: string): string {
	if (locale === 'hr') return p.name_hr || p.name_en;
	return p.name_en || p.name_hr;
}

/**
 * Tag-filter predicate shared across the renderer, list panel, and search.
 * `enabledTags` empty means "no filter" - returns true for every POI.
 * Otherwise the POI must carry at least one tag in the enabled set; tag-less
 * POIs fail the filter (otherwise the filter would be a no-op for any dataset
 * that isn't fully tagged).
 */
export function poiMatchesTagFilter(p: Poi, enabledTags: ReadonlySet<string>): boolean {
	if (enabledTags.size === 0) return true;
	if (!p.tags || p.tags.length === 0) return false;
	return p.tags.some((tag) => enabledTags.has(tag));
}

/** Collects the unique sorted set of tags present in the dataset. Used by
 *  the settings UI to render a chip per tag. */
export function collectPoiTags(pois: Poi[]): string[] {
	const set = new Set<string>();
	for (const p of pois) {
		if (!p.tags) continue;
		for (const t of p.tags) set.add(t);
	}
	return [...set].sort((a, b) => a.localeCompare(b));
}

/** Pick the smallest available thumbnail URL for a POI: the curated
 *  `images[0].thumbUrl`, then `images[0].url`, then the legacy `image` field.
 *  Returns null when no usable URL exists. Used by both the POI prefetcher and
 *  the trip-brief assembler so the precedence logic lives in one place. */
export function pickThumbUrl(poi: Poi): string | null {
	const first = poi.images?.[0];
	if (first) {
		const candidate = first.thumbUrl ?? first.url;
		if (candidate && isSafeUrl(candidate)) return candidate;
	}
	if (poi.image && isSafeUrl(poi.image)) return poi.image;
	return null;
}
