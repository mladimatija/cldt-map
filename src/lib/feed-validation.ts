/**
 * Validation for the trail feeds a remote URL can override (seasonal status,
 * trail notices), shared by the app's loaders and the push functions so both
 * accept exactly the same sources and entries: a notification never announces
 * an entry the app drops. Malformed entries are dropped one by one, not the
 * whole file. Free of runtime imports (types only), so the Netlify functions
 * can bundle it.
 */
import type { SeasonalStatusEntry, SeasonalStatusFile } from './seasonal-status';
import type { LocalizedString, TrailNotice } from './notices';

/** True for an absolute https URL: remote dataset overrides must not ride plain http. */
export function isHttpsUrl(url: string | undefined): url is string {
	if (!url) return false;
	try {
		return new URL(url).protocol === 'https:';
	} catch {
		return false;
	}
}

/** An http(s) URL, safe to render as a link (the rule of utils.isSafeUrl). */
function isLink(v: unknown): v is string {
	if (typeof v !== 'string') return false;
	try {
		const protocol = new URL(v).protocol;
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

function isText(v: unknown, maxLen: number): v is string {
	return typeof v === 'string' && v.length > 0 && v.length <= maxLen;
}

function isOptionalText(v: unknown, maxLen: number): boolean {
	return v === undefined || (typeof v === 'string' && v.length <= maxLen);
}

function isDate(v: unknown, maxLen: number): boolean {
	return isText(v, maxLen) && Number.isFinite(Date.parse(v));
}

function isOptionalKm(v: unknown): boolean {
	return v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
}

/* ------------------------------------------------------------------ */
/*  Seasonal status                                                    */
/* ------------------------------------------------------------------ */

const SEASONAL_SEVERITIES = new Set(['open', 'caution', 'closed_recommended', 'experts_only']);
const SEASONS = new Set(['winter', 'shoulder', 'summer', 'year-round']);
/** Defensive caps, at or above the schema's (public/seasonal-status.schema.json). */
const MAX_SEASONAL_ENTRIES = 500;
const MAX_ID_LEN = 80;
const MAX_NOTE_LEN = 800;
const MAX_TEXT_LEN = 200;

function normalizeSeasonalEntry(raw: unknown): SeasonalStatusEntry | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	if (
		!isText(o.id, MAX_ID_LEN) ||
		typeof o.severity !== 'string' ||
		!SEASONAL_SEVERITIES.has(o.severity) ||
		(o.season !== undefined && (typeof o.season !== 'string' || !SEASONS.has(o.season))) ||
		!isOptionalKm(o.distanceStartKm) ||
		!isOptionalKm(o.distanceEndKm) ||
		!isOptionalText(o.sectionId, MAX_TEXT_LEN) ||
		!isDate(o.validFrom, MAX_TEXT_LEN) ||
		!isDate(o.validUntil, MAX_TEXT_LEN) ||
		!isText(o.note_en, MAX_NOTE_LEN) ||
		!isText(o.note_hr, MAX_NOTE_LEN) ||
		!isOptionalText(o.gear, MAX_TEXT_LEN) ||
		!isText(o.source, MAX_TEXT_LEN) ||
		!isOptionalText(o.lastUpdated, MAX_TEXT_LEN)
	) {
		return null;
	}
	const entry = o as unknown as SeasonalStatusEntry;
	// A bad source link only loses the link.
	return o.sourceUrl === undefined || isLink(o.sourceUrl) ? entry : { ...entry, sourceUrl: undefined };
}

/** A seasonal-status file with its valid entries; null when it has no entry list. */
export function normalizeSeasonalStatusFile(raw: unknown): SeasonalStatusFile | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	if (!Array.isArray(o.entries) || o.entries.length > MAX_SEASONAL_ENTRIES) return null;
	const entries: SeasonalStatusEntry[] = [];
	for (const item of o.entries) {
		const entry = normalizeSeasonalEntry(item);
		if (entry) entries.push(entry);
	}
	return {
		lastUpdated: typeof o.lastUpdated === 'string' ? o.lastUpdated : '',
		source: typeof o.source === 'string' ? o.source : '',
		sourceUrl: isLink(o.sourceUrl) ? o.sourceUrl : undefined,
		entries,
	};
}

/* ------------------------------------------------------------------ */
/*  Trail notices                                                      */
/* ------------------------------------------------------------------ */

const NOTICE_SEVERITIES = new Set(['emergency', 'closure', 'warning', 'info']);
/** Defensive caps: notices are short banner texts. */
const MAX_NOTICES = 200;
const MAX_TITLE_LEN = 200;
const MAX_MESSAGE_LEN = 1000;
const MAX_LOCALES = 10;

function isLocalized(v: unknown, maxLen: number): v is LocalizedString {
	if (isText(v, maxLen)) return true;
	if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
	const values = Object.values(v);
	return (
		isText((v as { default?: unknown }).default, maxLen) &&
		values.length <= MAX_LOCALES &&
		values.every((t) => isText(t, maxLen))
	);
}

function normalizeNotice(raw: unknown): TrailNotice | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	// The message is optional: a notice can be a title alone.
	const hasMessage = o.message !== undefined && o.message !== '';
	if (
		!isText(o.id, MAX_ID_LEN) ||
		typeof o.severity !== 'string' ||
		!NOTICE_SEVERITIES.has(o.severity) ||
		!isLocalized(o.title, MAX_TITLE_LEN) ||
		(hasMessage && !isLocalized(o.message, MAX_MESSAGE_LEN)) ||
		(o.startsAt !== undefined && !isDate(o.startsAt, MAX_TEXT_LEN)) ||
		(o.expiresAt !== undefined && !isDate(o.expiresAt, MAX_TEXT_LEN)) ||
		!isOptionalKm(o.distanceStartKm) ||
		!isOptionalKm(o.distanceEndKm) ||
		!isOptionalText(o.url, MAX_MESSAGE_LEN)
	) {
		return null;
	}
	return {
		...(o as unknown as TrailNotice),
		message: hasMessage ? (o.message as LocalizedString) : '',
		dismissible: o.dismissible === true,
	};
}

/** The valid notices of a notices file (expired ones included); null when it
 *  has no notice list. */
export function normalizeNoticeList(raw: unknown): TrailNotice[] | null {
	const list = raw && typeof raw === 'object' ? (raw as { notices?: unknown }).notices : undefined;
	if (!Array.isArray(list) || list.length > MAX_NOTICES) return null;
	const notices: TrailNotice[] = [];
	for (const item of list) {
		const notice = normalizeNotice(item);
		if (notice) notices.push(notice);
	}
	return notices;
}
