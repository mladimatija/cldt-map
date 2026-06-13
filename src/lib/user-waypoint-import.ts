/**
 * Import parsers for personal waypoints (GPX `<wpt>`) and trip journal (Markdown
 * exported by journalToMarkdown). Pure functions - no store access.
 */
import { nextWaypointName, type JournalEntry, type UserWaypoint } from './user-waypoints';
import { gpxTextToWaypointCategory, normalizeWaypointCategory } from './waypoint-categories';

export const MAX_WAYPOINT_GPX_BYTES = 2 * 1024 * 1024;
export const MAX_JOURNAL_MD_BYTES = 512 * 1024;
export const MAX_WAYPOINTS_PER_IMPORT = 100;
export const MAX_JOURNAL_ENTRIES_PER_IMPORT = 100;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLDT_JOURNAL_RANGE_RE = /<!--\s*cldt-journal-range:([\d.]+),([\d.]+)\s*-->/;
const DATE_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/m;

export interface ParsedGpxWaypoint {
	lat: number;
	lng: number;
	name: string;
	note: string;
	category: ReturnType<typeof normalizeWaypointCategory>;
}

export interface ParsedJournalEntry {
	date: string;
	text: string;
	startKm?: number;
	endKm?: number;
}

function assertSafeXml(xml: string, maxBytes: number): void {
	if (xml.length > maxBytes) throw new Error('FILE_TOO_LARGE');
	if (/<!DOCTYPE/i.test(xml)) throw new Error('UNSUPPORTED_DOCTYPE');
}

/** Parse GPX 1.x waypoint elements from a file (tracks are ignored). */
export function parseGpxWaypoints(xml: string): ParsedGpxWaypoint[] {
	assertSafeXml(xml, MAX_WAYPOINT_GPX_BYTES);

	const doc = new DOMParser().parseFromString(xml, 'text/xml');
	if (doc.querySelector('parsererror')) throw new Error('MALFORMED');

	const result: ParsedGpxWaypoint[] = [];
	for (const wpt of Array.from(doc.getElementsByTagName('wpt'))) {
		const latAttr = wpt.getAttribute('lat');
		const lonAttr = wpt.getAttribute('lon');
		if (latAttr === null || lonAttr === null) continue;

		const lat = parseFloat(latAttr);
		const lng = parseFloat(lonAttr);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

		const name = wpt.getElementsByTagName('name')[0]?.textContent?.trim() || '';
		const desc = wpt.getElementsByTagName('desc')[0]?.textContent?.trim() || '';
		const cmt = wpt.getElementsByTagName('cmt')[0]?.textContent?.trim() || '';
		const type = wpt.getElementsByTagName('type')[0]?.textContent?.trim() || '';
		const sym = wpt.getElementsByTagName('sym')[0]?.textContent?.trim() || '';
		const note = desc || cmt;

		result.push({
			lat,
			lng,
			name: name || `Waypoint ${result.length + 1}`,
			note,
			category: gpxTextToWaypointCategory(type, sym),
		});

		if (result.length >= MAX_WAYPOINTS_PER_IMPORT) break;
	}

	if (result.length === 0) throw new Error('NO_WAYPOINTS');
	return result;
}

function stripRangeMetadataLines(body: string): string {
	return body
		.split('\n')
		.filter((line) => !CLDT_JOURNAL_RANGE_RE.test(line.trim()))
		.join('\n')
		.trim();
}

/** Parse journal markdown (CLDT export or compatible `## YYYY-MM-DD` sections). */
export function parseJournalMarkdown(md: string): ParsedJournalEntry[] {
	if (md.length > MAX_JOURNAL_MD_BYTES) throw new Error('FILE_TOO_LARGE');

	const matches = [...md.matchAll(DATE_HEADING_RE)];
	if (matches.length === 0) throw new Error('NO_ENTRIES');

	const entries: ParsedJournalEntry[] = [];

	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const date = match[1];
		if (!ISO_DATE_RE.test(date)) continue;

		const bodyStart = (match.index ?? 0) + match[0].length;
		const bodyEnd = i + 1 < matches.length ? (matches[i + 1].index ?? md.length) : md.length;
		let body = md.slice(bodyStart, bodyEnd);

		let startKm: number | undefined;
		let endKm: number | undefined;
		const rangeMatch = body.match(CLDT_JOURNAL_RANGE_RE);
		if (rangeMatch) {
			const lo = parseFloat(rangeMatch[1]);
			const hi = parseFloat(rangeMatch[2]);
			if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
				startKm = lo;
				endKm = hi;
			}
		}

		body = stripRangeMetadataLines(body);
		// Drop a single leading range summary line (Stretch: ...) when present.
		const lines = body.split('\n');
		if (lines.length > 1 && /^[^:]+:\s*.+\s-\s*.+/.test(lines[0].trim())) {
			body = lines.slice(1).join('\n').trim();
		}

		const text = body.trim();
		if (!text) continue;

		entries.push({
			date,
			text,
			...(startKm !== undefined && endKm !== undefined ? { startKm, endKm } : {}),
		});

		if (entries.length >= MAX_JOURNAL_ENTRIES_PER_IMPORT) break;
	}

	if (entries.length === 0) throw new Error('NO_ENTRIES');
	return entries;
}

/** Convert parsed GPX waypoints into store-ready records with unique names. */
export function gpxWaypointsToUserWaypoints(
	parsed: readonly ParsedGpxWaypoint[],
	existing: readonly UserWaypoint[],
	options: {
		newId: () => string;
		snapTrailKm: (lat: number, lng: number) => number | null;
		now?: string;
	},
): UserWaypoint[] {
	const batch: UserWaypoint[] = [];
	const now = options.now ?? new Date().toISOString();
	for (const w of parsed) {
		batch.push({
			id: options.newId(),
			lat: w.lat,
			lng: w.lng,
			name: nextWaypointName([...existing, ...batch], w.name),
			note: w.note,
			category: w.category,
			createdAt: now,
			trailKm: options.snapTrailKm(w.lat, w.lng),
		});
	}
	return batch;
}

/** Convert parsed journal sections into store-ready entries. */
export function parsedJournalToEntries(
	parsed: readonly ParsedJournalEntry[],
	newId: () => string,
	now?: string,
): JournalEntry[] {
	const createdAt = now ?? new Date().toISOString();
	return parsed.map((entry) => ({
		id: newId(),
		date: entry.date,
		text: entry.text,
		createdAt,
		...(entry.startKm !== undefined && entry.endKm !== undefined ? { startKm: entry.startKm, endKm: entry.endKm } : {}),
	}));
}
