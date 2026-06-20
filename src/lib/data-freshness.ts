/**
 * Shared "how fresh is this data" primitive for the curated safety feeds
 * (seasonal status, trail notices, ...). Each feed carries its own lastUpdated
 * date; after weeks offline a hiker can wrongly read "no warning shown" as "all
 * clear", so the UI uses this to surface an honest staleness signal and point
 * back at the official source. Pure (the caller passes `now`) so it stays
 * render-safe and reusable across feeds.
 */

/** Default age (days) past which a curated safety feed is treated as possibly stale. */
export const FEED_STALE_THRESHOLD_DAYS = 21;

/**
 * Whole days between an ISO date (yyyy-mm-dd or full ISO) and `now` (epoch ms).
 * Returns null when the date is unparseable, and clamps future dates to 0 so a
 * clock skew never reports a negative age.
 */
export function feedAgeDays(lastUpdatedIso: string, now: number): number | null {
	const updatedMs = Date.parse(lastUpdatedIso);
	if (Number.isNaN(updatedMs)) return null;
	const days = Math.floor((now - updatedMs) / 86_400_000);
	return days < 0 ? 0 : days;
}

/**
 * True when the feed's lastUpdated is older than `thresholdDays`. An unparseable
 * date is treated as NOT stale, so malformed data never raises a false alarm.
 */
export function isFeedStale(
	lastUpdatedIso: string,
	now: number,
	thresholdDays: number = FEED_STALE_THRESHOLD_DAYS,
): boolean {
	const age = feedAgeDays(lastUpdatedIso, now);
	return age !== null && age > thresholdDays;
}
