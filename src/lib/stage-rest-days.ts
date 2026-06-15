/**
 * Rest-day (zero-day) math for multi-day stage plans.
 *
 * A rest day is recorded as the 0-based index of the stage it follows, so a
 * value of k means "rest after stage k, before stage k+1". The same index may
 * appear more than once to model a multi-day rest. Rest days never change how
 * the trail is partitioned into stages - they only push the calendar date of
 * every later stage (and of the rest day itself) one day further along.
 *
 * The anchor list lives inside StagePlan.restDays (persisted with the plan), so
 * these helpers are the single source of truth for turning a stage index into a
 * day offset from the trip start. Both the per-stage weather forecasts and the
 * iCal export read dates through dayOffsetForStage so a rest day shifts them in
 * lockstep.
 */

/**
 * Sanitized, ascending list of rest-day anchor indices (finite, >= 0). Trusted
 * input only - it does not bound anchors against the stage count, so untrusted
 * data (e.g. a share URL) must go through share-trip-state's parseStagePlan,
 * which also enforces the `< stages.length` upper bound.
 */
export function normalizeRestDays(restDays: readonly number[] | undefined): number[] {
	if (!restDays?.length) return [];
	return restDays.filter((k) => Number.isInteger(k) && k >= 0).sort((a, b) => a - b);
}

/**
 * Day offset (calendar days from the trip start) of stage `stageIndex`,
 * counting every rest day taken before it. A stage's date is
 * startDate + dayOffsetForStage(stageIndex, restDays).
 */
export function dayOffsetForStage(stageIndex: number, restDays: readonly number[] | undefined): number {
	if (!restDays?.length) return stageIndex;
	let extra = 0;
	for (const k of restDays) if (k < stageIndex) extra += 1;
	return stageIndex + extra;
}

/** Number of rest days anchored after stage `stageIndex`. */
export function restDayCountAfter(stageIndex: number, restDays: readonly number[] | undefined): number {
	if (!restDays?.length) return 0;
	let count = 0;
	for (const k of restDays) if (k === stageIndex) count += 1;
	return count;
}

/**
 * Day offset of the `occurrence`-th (0-based) rest day taken after stage
 * `stageIndex`. The rest day falls the day after the stage's own day, plus any
 * earlier rest days that share the anchor.
 */
export function dayOffsetForRestDayAfter(
	stageIndex: number,
	occurrence: number,
	restDays: readonly number[] | undefined,
): number {
	return dayOffsetForStage(stageIndex, restDays) + 1 + occurrence;
}

/** Total trip length in days = hiking stages + rest days. */
export function totalTripDays(stageCount: number, restDays: readonly number[] | undefined): number {
	return stageCount + (restDays?.length ?? 0);
}
