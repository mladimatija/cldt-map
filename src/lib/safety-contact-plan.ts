/**
 * Assembles the plain-text "safety contact" trip-plan handoff a hiker sends to
 * a trusted contact so, if they do not check in, the contact can pass it to
 * rescuers. The app never sends, uploads, or tracks anything - this is pure
 * string assembly. Like `buildCheckinNote`, the caller supplies already-
 * localized templates and per-stage facts so this stays render-safe and
 * i18n-agnostic (no next-intl import here).
 *
 * The builder owns the parts that must not diverge between the two call sites
 * (the stage-planner panel and the trip-brief exporters): day numbering,
 * rest-day interleaving, anchor-coordinate formatting, and the graceful
 * degradation when the plan has no start date. `buildSafetyContactPlanInput`
 * (below) owns the matching input assembly - stage-end accommodation anchoring,
 * rest-day dating, and the alert deadline - so that math also lives in one place.
 */

import { poiDisplayName, type Poi } from '@/lib/pois';
import { findStageEndAccommodation } from '@/lib/stage-accommodation';
import { stageCalendarDate } from '@/lib/stage-ical-export';
import { dayOffsetForRestDayAfter, dayOffsetForStage, restDayCountAfter, totalTripDays } from '@/lib/stage-rest-days';
import { formatShortWeekdayDate } from '@/lib/date-format';
import type { StagePlan } from '@/lib/store/types';

/** Default number of days after the planned finish before the contact should
 *  raise the alarm. One day gives a late finish room without overreacting. */
export const DEFAULT_SAFETY_BUFFER_DAYS = 1;

/** Localized template strings (from messages `stagePlanner.safetyContact.*`). */
export interface SafetyContactTemplates {
	heading: string;
	intro: string;
	/** "Day {day} ({date}): km {from} to {to}, sleep near {anchor}." */
	dayLine: string;
	/** Same as `dayLine` without the "({date})" fragment. */
	dayLineNoDate: string;
	/** "{name} ({lat}, {lng})" - {lat}/{lng} filled with 6-decimal coordinates. */
	sleepAnchor: string;
	/** Fragment used for {anchor} when the stage has no fixed overnight point. */
	noAnchor: string;
	/** "Day {day} ({date}): rest day." - only emitted for dated rest days. */
	restDay: string;
	/** "...by {date}, call 112..." - used when a deadline date is known. */
	closing: string;
	/** "...by my planned return, call 112..." - used with no trip start date. */
	closingNoDate: string;
}

/** Builds {@link SafetyContactTemplates} from a namespace translator scoped to
 *  `stagePlanner`, mapping the nine `safetyContact.*` message keys in one place
 *  so the stage-planner panel and the trip-brief exporter cannot drift.
 *
 *  Uses the translator's `raw` accessor, not the formatting call: these are
 *  literal templates whose `{day}`/`{date}`/`{anchor}` slots are filled later by
 *  `buildSafetyContactPlan`/`fillAnchor` via string replacement. Calling `t(key)`
 *  would make next-intl parse the ICU placeholders at lookup time and throw a
 *  FORMATTING_ERROR because no values are supplied. */
export function safetyContactTemplates(t: { raw: (key: string) => string }): SafetyContactTemplates {
	return {
		heading: t.raw('safetyContact.heading'),
		intro: t.raw('safetyContact.intro'),
		dayLine: t.raw('safetyContact.dayLine'),
		dayLineNoDate: t.raw('safetyContact.dayLineNoDate'),
		sleepAnchor: t.raw('safetyContact.sleepAnchor'),
		noAnchor: t.raw('safetyContact.noAnchor'),
		restDay: t.raw('safetyContact.restDay'),
		closing: t.raw('safetyContact.closing'),
		closingNoDate: t.raw('safetyContact.closingNoDate'),
	};
}

/** A fixed overnight point (hut / shelter / town) at a stage boundary. */
export interface SafetyContactAnchor {
	name: string;
	lat: number;
	lng: number;
}

/** One hiking stage plus any rest days taken after it. */
export interface SafetyContactStage {
	/** SOBO trail km at the stage start / end (rendered rounded to whole km). */
	fromKm: number;
	toKm: number;
	/** Calendar date label for the stage; empty when the plan has no start date. */
	dateLabel: string;
	/** Overnight anchor at the stage end, or null when there is no fixed point. */
	anchor: SafetyContactAnchor | null;
	/** Calendar date labels of rest days taken after this stage, in order. Left
	 *  empty when the plan has no start date, so undated rest days are dropped. */
	restDayLabels: string[];
}

export interface SafetyContactPlanInput {
	templates: SafetyContactTemplates;
	stages: SafetyContactStage[];
	/** Deadline (finish + buffer) date label for the closing line; empty when
	 *  the plan has no start date, which switches to the undated closing. */
	deadlineLabel: string;
}

export interface SafetyContactPlan {
	/** Full multi-line text for copy / share / SMS (includes the heading). */
	body: string;
	/** Content lines (intro, per-day, closing) without the heading, for the
	 *  trip-brief exporters that render the heading separately. */
	lines: string[];
}

/** Fill the {anchor} slot: the overnight place name plus its coordinates
 *  formatted to 6 decimals (ASCII), or the "no fixed point" fragment. */
function fillAnchor(templates: SafetyContactTemplates, anchor: SafetyContactAnchor | null): string {
	if (!anchor) return templates.noAnchor;
	const lat = Number.isFinite(anchor.lat) ? anchor.lat.toFixed(6) : '';
	const lng = Number.isFinite(anchor.lng) ? anchor.lng.toFixed(6) : '';
	return templates.sleepAnchor.replace('{name}', anchor.name).replace('{lat}', lat).replace('{lng}', lng);
}

/** Builds the safety-contact plan text. Interleaves rest days in calendar
 *  order and numbers every entry sequentially ("Day N" = calendar day when a
 *  start date is set, else stage number). Drops empty fragments. */
export function buildSafetyContactPlan(input: SafetyContactPlanInput): SafetyContactPlan {
	const { templates, stages, deadlineLabel } = input;

	const dayLines: string[] = [];
	let dayNumber = 0;
	for (const stage of stages) {
		dayNumber += 1;
		const template = stage.dateLabel ? templates.dayLine : templates.dayLineNoDate;
		const line = template
			.replace('{day}', String(dayNumber))
			.replace('{date}', stage.dateLabel)
			.replace('{from}', String(Math.round(stage.fromKm)))
			.replace('{to}', String(Math.round(stage.toKm)))
			.replace('{anchor}', fillAnchor(templates, stage.anchor))
			.trim();
		if (line) dayLines.push(line);

		// Rest-day labels are only populated when the plan is dated, so an undated
		// plan never emits a rest line (the template needs a calendar date).
		for (const restLabel of stage.restDayLabels) {
			dayNumber += 1;
			const restLine = templates.restDay.replace('{day}', String(dayNumber)).replace('{date}', restLabel).trim();
			if (restLine) dayLines.push(restLine);
		}
	}

	const heading = templates.heading.trim();
	const intro = templates.intro.trim();
	const closing = (deadlineLabel ? templates.closing.replace('{date}', deadlineLabel) : templates.closingNoDate).trim();

	const lines = [intro, ...dayLines, closing].filter((l) => l.length > 0);

	const groups: string[] = [];
	if (heading) groups.push(heading);
	if (intro) groups.push(intro);
	if (dayLines.length > 0) groups.push(dayLines.join('\n'));
	if (closing) groups.push(closing);

	return { body: groups.join('\n\n'), lines };
}

/** Inputs for {@link buildSafetyContactPlanInput}. */
export interface SafetyContactPlanInputOptions {
	stagePlan: StagePlan;
	/** Overnight candidates (huts / shelters / towns) used to anchor each stage
	 *  end; typically `filterOvernightCandidates(poisFile.pois)`. */
	overnightPois: Poi[];
	/** Localized templates for the closing/day lines (from next-intl at the call site). */
	templates: SafetyContactTemplates;
	locale: string;
	/** Days after the planned finish before the contact should raise the alarm
	 *  (session buffer in the planner, {@link DEFAULT_SAFETY_BUFFER_DAYS} in the exporter). */
	bufferDays: number;
}

/**
 * Assembles the {@link SafetyContactPlanInput} (per-stage rows + deadline label)
 * from a stage plan and its overnight anchors. This is the input-mapping half of
 * the safety-contact plan that must not diverge between the stage-planner panel
 * and the trip-brief exporter: stage-end accommodation anchoring, rest-day
 * dating, dateLabel derivation, and the finish + buffer deadline. Kept next to
 * {@link buildSafetyContactPlan} so both halves share one source of truth.
 */
export function buildSafetyContactPlanInput({
	stagePlan,
	overnightPois,
	templates,
	locale,
	bufferDays,
}: SafetyContactPlanInputOptions): SafetyContactPlanInput {
	const stages: SafetyContactStage[] = stagePlan.stages.map((stage, i) => {
		const acc = findStageEndAccommodation(stage.endKm, overnightPois);
		const restDayLabels: string[] = [];
		if (stagePlan.startDate) {
			const restCount = restDayCountAfter(i, stagePlan.restDays);
			for (let occ = 0; occ < restCount; occ++) {
				restDayLabels.push(
					formatShortWeekdayDate(
						stageCalendarDate(stagePlan.startDate, dayOffsetForRestDayAfter(i, occ, stagePlan.restDays)),
						locale,
					),
				);
			}
		}
		return {
			fromKm: stage.startKm,
			toKm: stage.endKm,
			dateLabel: stagePlan.startDate
				? formatShortWeekdayDate(
						stageCalendarDate(stagePlan.startDate, dayOffsetForStage(i, stagePlan.restDays)),
						locale,
					)
				: '',
			anchor: acc ? { name: poiDisplayName(acc.poi, locale), lat: acc.poi.lat, lng: acc.poi.lng } : null,
			restDayLabels,
		};
	});
	// Deadline = last calendar day of the trip (stages + rest days) plus the
	// buffer, so a trailing rest day never shortens the alert window.
	const deadlineLabel = stagePlan.startDate
		? formatShortWeekdayDate(
				stageCalendarDate(
					stagePlan.startDate,
					totalTripDays(stagePlan.stages.length, stagePlan.restDays) - 1 + bufferDays,
				),
				locale,
			)
		: '';
	return { templates, stages, deadlineLabel };
}
