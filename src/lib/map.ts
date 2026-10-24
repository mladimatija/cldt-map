/**
 * Trail timing helper: estimated passage days for a distance and ascent.
 */

/**
 * Estimate average passage time in days using Naismith's rule.
 * Naismith: 1 h per paceKmh km + 1 h per 600 m ascent. Assumes 7 hiking hours per day.
 * @param distanceM Distance in meters
 * @param ascentM Total ascent in meters
 * @param paceKmh Walking pace in km/h
 * @returns Estimated days (rounded to 1 decimal)
 */
export function estimatePassageDays(distanceM: number, ascentM: number, paceKmh: number): number {
	const distanceKm = distanceM / 1000;
	const hours = distanceKm / paceKmh + ascentM / 600;
	const days = hours / 7;
	return Math.round(days * 10) / 10;
}
