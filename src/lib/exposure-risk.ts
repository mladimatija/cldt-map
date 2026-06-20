/**
 * Plain-language cold/heat exposure advisory derived from the already-fetched
 * feels-like temperature and wind speed. Advisory only - a glanceable nudge, not
 * a medical threshold, and never a push/banner (surfaced inline in the location
 * tooltip weather block).
 *
 * The feels-like value from the weather API already folds in wind chill, so the
 * tiers key mainly on feels-like, with one extra wind gate for the cool-and-windy
 * exposed-ridgeline case that a mild feels-like can understate.
 */

export type ExposureLevel = 'coldWarning' | 'coldCaution' | 'heatCaution' | 'heatWarning' | null;

/** Feels-like (C) bounds for each tier. */
const COLD_WARNING_C = -5;
const COLD_CAUTION_C = 3;
const HEAT_CAUTION_C = 30;
const HEAT_WARNING_C = 35;
/** Cool-and-windy gate: a cold caution on exposed terrain even when feels-like is mild. */
const WINDY_COLD_FEELS_C = 8;
const WINDY_COLD_KMH = 40;

export function classifyExposure(feelsLikeC: number, windspeedKmh: number): ExposureLevel {
	if (!Number.isFinite(feelsLikeC)) return null;
	if (feelsLikeC <= COLD_WARNING_C) return 'coldWarning';
	if (feelsLikeC <= COLD_CAUTION_C) return 'coldCaution';
	if (feelsLikeC >= HEAT_WARNING_C) return 'heatWarning';
	if (feelsLikeC >= HEAT_CAUTION_C) return 'heatCaution';
	if (feelsLikeC <= WINDY_COLD_FEELS_C && windspeedKmh >= WINDY_COLD_KMH) return 'coldCaution';
	return null;
}

/** Cold tiers tint blue, heat tiers tint amber. */
export function exposureTone(level: Exclude<ExposureLevel, null>): 'cold' | 'heat' {
	return level.startsWith('cold') ? 'cold' : 'heat';
}

/** Builds the localized tooltip advisory, or null when conditions are benign.
 *  `translate` maps a level key to its localized string (e.g. weather.exposure.*). */
export function buildExposureAdvisory(
	feelsLikeC: number,
	windspeedKmh: number,
	translate: (level: Exclude<ExposureLevel, null>) => string,
): { text: string; tone: 'cold' | 'heat' } | null {
	const level = classifyExposure(feelsLikeC, windspeedKmh);
	if (!level) return null;
	return { text: translate(level), tone: exposureTone(level) };
}

/** Tooltip-ready advisory from a weather reading. `t` is a `weather`-namespace
 *  translator; the helper resolves the `exposure.*` keys. */
export function tooltipExposure(
	feelsLikeC: number,
	windspeedKmh: number,
	t: (key: string) => string,
): { text: string; tone: 'cold' | 'heat' } | null {
	return buildExposureAdvisory(feelsLikeC, windspeedKmh, (level) => t(`exposure.${level}`));
}
