import { createDatasetLoader } from '@/lib/dataset-loader';
import { normalizeSeasonalStatusFile } from '@/lib/feed-validation';

export type SeasonalSeverity = 'open' | 'caution' | 'closed_recommended' | 'experts_only';

export type SeasonalSeason = 'winter' | 'shoulder' | 'summer' | 'year-round';

export interface SeasonalStatusEntry {
	id: string;
	severity: SeasonalSeverity;
	season?: SeasonalSeason;
	distanceStartKm?: number;
	distanceEndKm?: number;
	sectionId?: string;
	validFrom: string;
	validUntil: string;
	note_en: string;
	note_hr: string;
	gear?: string;
	source: string;
	sourceUrl?: string;
	lastUpdated?: string;
}

export interface SeasonalStatusFile {
	lastUpdated: string;
	source: string;
	sourceUrl?: string;
	entries: SeasonalStatusEntry[];
}

/** Severity ordering for overlap resolution: highest wins. */
const SEVERITY_RANK: Record<SeasonalSeverity, number> = {
	open: 1,
	caution: 2,
	closed_recommended: 3,
	experts_only: 4,
};

export function severityRank(severity: SeasonalSeverity): number {
	return SEVERITY_RANK[severity];
}

/**
 * Polyline tint color per severity.
 */
const SEVERITY_COLOR: Record<SeasonalSeverity, string> = {
	open: '#15803D',
	caution: '#A16207',
	closed_recommended: '#C2410C',
	experts_only: '#DC2626',
};

export function severityColor(severity: SeasonalSeverity): string {
	return SEVERITY_COLOR[severity];
}

/** Resolves the localized note for the given locale. Falls back to English. */
export function resolveSeasonalNote(entry: SeasonalStatusEntry, locale: string): string {
	if (locale === 'hr') return entry.note_hr;
	return entry.note_en;
}

/** Returns only entries whose date window covers `now`. */
export function filterActiveEntries(entries: SeasonalStatusEntry[], now: Date = new Date()): SeasonalStatusEntry[] {
	const nowTs = now.getTime();
	return entries.filter((e) => {
		const from = Date.parse(e.validFrom);
		const until = Date.parse(e.validUntil);
		if (Number.isNaN(from) || Number.isNaN(until)) return false;
		// validUntil is inclusive: treat the end of that calendar day as valid.
		const untilEndOfDay = until + 24 * 60 * 60 * 1000 - 1;
		return from <= nowTs && nowTs <= untilEndOfDay;
	});
}

/** Default layer-toggle state: on during the winter window (Nov 1 - May 31). */
export function isSeasonalStatusDefaultEnabled(now: Date = new Date()): boolean {
	const m = now.getMonth(); // 0-indexed: Jan=0, Dec=11
	// Nov (10), Dec (11), Jan (0), Feb (1), Mar (2), Apr (3), May (4)
	return m >= 10 || m <= 4;
}

const seasonalStatusLoader = createDatasetLoader({
	remoteUrl: process.env.NEXT_PUBLIC_SEASONAL_STATUS_URL,
	localPath: '/seasonal-status.json',
	normalize: normalizeSeasonalStatusFile,
});

/**
 * Loads seasonal trail status entries, trying the remote URL first (if configured
 * via NEXT_PUBLIC_SEASONAL_STATUS_URL, https only) and falling back to the bundled
 * /seasonal-status.json. Cached for the page until resetSeasonalStatusCache().
 * Returns null if neither source is reachable or valid.
 */
export const loadSeasonalStatus = seasonalStatusLoader.load;

/** Marks the dataset stale: the next loadSeasonalStatus call revalidates. */
export const resetSeasonalStatusCache = seasonalStatusLoader.reset;

/**
 * Compact localised range like "12 May - 12 Aug". Falls back to raw ISO if
 * either date fails to parse.
 */
export function formatSeasonalDateRange(fromIso: string, untilIso: string, locale: string): string {
	try {
		const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
		const from = new Date(fromIso);
		const until = new Date(untilIso);
		if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime())) {
			return `${fromIso} - ${untilIso}`;
		}
		return `${fmt.format(from)} - ${fmt.format(until)}`;
	} catch {
		return `${fromIso} - ${untilIso}`;
	}
}
