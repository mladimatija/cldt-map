/**
 * Shared localization plumbing for the trip-brief PDF and DOCX generators.
 *
 * The actual strings live in messages/<locale>.json under
 * `tripBrief.document` - the same place as every other user-facing string -
 * so translators and the i18n parity check cover them. The exporters run
 * outside React/next-intl, so the caller (the trip-brief modal) resolves the
 * active locale's subtree once via `useMessages()` and threads it through
 * `TripBrief.meta.strings`; everything here just consumes that object.
 *
 * Full Croatian / German diacritics are safe: the PDF generator embeds a
 * subsetted Noto Sans (see `trip-brief-fonts.ts`) covering Basic Latin,
 * Latin-1 Supplement, and Latin Extended-A, and the DOCX path has always
 * supported the full Unicode range.
 */

import type { TripBrief, TripBriefDay } from '@/lib/trip-brief';
import { TrailDirection } from '@/lib/types';
import { formatShortWeekdayDate } from './date-format';

export type TripBriefLocale = TripBrief['meta']['locale'];

/** Shape of the `tripBrief.document` subtree in messages/<locale>.json.
 *  Single-locale: the caller resolves the active locale before export. */
export interface TripBriefStrings {
	labels: {
		overview: string;
		totalDistance: string;
		dayCount: string;
		direction: string;
		gain: string;
		loss: string;
		eta: string;
		pace: string;
		alerts: string;
		pois: string;
		emergency: string;
		generated: string;
		/** Cover-table label for the pack summary row. */
		pack: string;
		/** Suffix appended to a town POI line when groceries are available. */
		resupply: string;
		/** Cover-table label for the food resupply cadence row. */
		resupplyCadence: string;
	};
	daysHeading: string;
	moreLabel: string;
	/** Direction descriptors used inside the overview narrative sentence. */
	narrativeDirection: Record<TrailDirection, string>;
	/** Template: {day}, {totalDays}, {distanceLabel}, {gain}, {loss}, {poiSentence}. */
	dayNarrative: string;
	dayPoiSentence: { withPois: string; empty: string };
	/** Template: {totalDistanceLabel}, {dayCount}, {direction}, {etaLabel}. */
	overviewNarrative: string;
	/** Standalone direction display line for the cover table. */
	directionDisplay: Record<TrailDirection, string>;
	/** Template: {day}, {unit}, {start}, {end}. */
	dayHeader: string;
	/** Heading + body copy for a planned rest (zero) day page / section. */
	restDay: { heading: string; body: string };
	/** Emergency back-page bullet lines. */
	emergencyBody: { l1: string; l2: string; l3: string; l4: string; l5: string };
}

/**
 * Extracts and shape-checks the exporter strings from a messages subtree
 * (`messages.tripBrief.document` for the active locale). Throws loudly when
 * the subtree is missing or malformed - a silent fallback would ship a
 * half-translated document.
 */
export function tripBriefStringsFromMessages(documentMessages: unknown): TripBriefStrings {
	const s = documentMessages as TripBriefStrings | undefined;
	if (
		!s ||
		typeof s.labels?.overview !== 'string' ||
		typeof s.dayNarrative !== 'string' ||
		typeof s.overviewNarrative !== 'string' ||
		typeof s.dayHeader !== 'string' ||
		typeof s.narrativeDirection?.SOBO !== 'string' ||
		typeof s.directionDisplay?.SOBO !== 'string' ||
		typeof s.dayPoiSentence?.withPois !== 'string' ||
		typeof s.restDay?.heading !== 'string' ||
		typeof s.restDay?.body !== 'string' ||
		typeof s.emergencyBody?.l1 !== 'string'
	) {
		throw new Error('tripBrief.document strings missing from messages - check messages/<locale>.json');
	}
	return s;
}

/** Emergency back-page lines in render order. */
export function emergencyLines(s: TripBriefStrings): string[] {
	return [s.emergencyBody.l1, s.emergencyBody.l2, s.emergencyBody.l3, s.emergencyBody.l4, s.emergencyBody.l5];
}

/** Render the per-day narrative line for the trip brief. */
export function formatDayNarrative(args: {
	day: number;
	totalDays: number;
	distanceLabel: string;
	gainM: number;
	lossM: number;
	poiCount: number;
	strings: TripBriefStrings;
}): string {
	const { day, totalDays, distanceLabel, gainM, lossM, poiCount, strings } = args;
	const poiSentence =
		poiCount > 0
			? strings.dayPoiSentence.withPois.replace('{poiCount}', String(poiCount))
			: strings.dayPoiSentence.empty;
	return strings.dayNarrative
		.replace('{day}', String(day))
		.replace('{totalDays}', String(totalDays))
		.replace('{distanceLabel}', distanceLabel)
		.replace('{gain}', String(Math.round(gainM)))
		.replace('{loss}', String(Math.round(lossM)))
		.replace('{poiSentence}', poiSentence);
}

/** Render the trip-level overview narrative for the cover page. */
export function formatOverviewNarrative(args: {
	totalDistanceLabel: string;
	dayCount: number;
	direction: TrailDirection;
	strings: TripBriefStrings;
	etaLabel: string;
}): string {
	const { totalDistanceLabel, dayCount, direction, strings, etaLabel } = args;
	return strings.overviewNarrative
		.replace('{totalDistanceLabel}', totalDistanceLabel)
		.replace('{dayCount}', String(dayCount))
		.replace('{direction}', strings.narrativeDirection[direction])
		.replace('{etaLabel}', etaLabel);
}

/** Direction display string shared across PDF and DOCX. */
export function directionDisplay(d: TrailDirection, s: TripBriefStrings): string {
	return s.directionDisplay[d];
}

/** Day header string (e.g. "Day 1 - km 0 to 25") shared across PDF and DOCX. */
export function dayHeader(day: TripBriefDay, s: TripBriefStrings, units: TripBrief['meta']['units']): string {
	return s.dayHeader
		.replace('{day}', String(day.index + 1))
		.replace('{unit}', units === 'imperial' ? 'mi' : 'km')
		.replace('{start}', String(Math.round(day.directionStartKm)))
		.replace('{end}', String(Math.round(day.directionEndKm)));
}

/** Compact calendar-date line for a day (e.g. "Mon 17 Jun"); empty when the
 *  plan has no start date and the day therefore carries no date. */
export function dayDateLabel(day: TripBriefDay, locale: string): string {
	return day.date ? formatShortWeekdayDate(day.date, locale) : '';
}

/** Format a distance value for display in trip-brief documents. */
export function formatKmRound(km: number, units: TripBrief['meta']['units']): string {
	if (units === 'imperial') return `${(km * 0.621371).toFixed(1)} mi`;
	return `${km.toFixed(1)} km`;
}

/** Today's date as an ISO 8601 string (YYYY-MM-DD). */
export function todayIsoDate(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export { formatIsoDate as formatGeneratedAt } from './date-format';
