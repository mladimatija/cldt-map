/**
 * Severe-weather warnings. /api/meteoalarm returns the active MeteoAlarm
 * warnings per county code (SevereWeatherResponse); the client joins them with
 * the county outlines in /data/meteoalarm-regions-hr.json, loaded once, into
 * one GeoJSON Feature per county for the map layer and the GPS banner.
 */

/** MeteoAlarm awareness levels 2-4 (level 1, green, means no warning). */
export type SeverityLevel = 'yellow' | 'orange' | 'red';

export const SEVERITY_ORDER: Record<SeverityLevel, number> = { red: 3, orange: 2, yellow: 1 };

/** MeteoAlarm awareness_type ids and the message keys they translate to
 *  (messages `severeWeather.type.*`). */
export const AWARENESS_TYPES = {
	1: 'wind',
	2: 'snowIce',
	3: 'thunderstorm',
	4: 'fog',
	5: 'highTemperature',
	6: 'lowTemperature',
	7: 'coastalEvent',
	8: 'forestFire',
	9: 'avalanche',
	10: 'rain',
	12: 'flood',
	13: 'rainFlood',
	14: 'marineHazard',
	15: 'drought',
} as const;

export type AwarenessType = (typeof AWARENESS_TYPES)[keyof typeof AWARENESS_TYPES];

export interface RegionWarning {
	/** CAP alert identifier: stable across polls; dismissing it hides it in
	 *  every county the alert covers. */
	id: string;
	severity: SeverityLevel;
	/** Event headline in the requested language, e.g. "Yellow wind warning". */
	event: string;
	awarenessType: AwarenessType | null;
	/** ISO times; empty when the feed gave none (then open-ended). */
	validFrom: string;
	validUntil: string;
	source: string;
}

/** /api/meteoalarm body: warnings by NUTS 2021 level 3 county code, highest level first. */
export interface SevereWeatherResponse {
	regions: Record<string, RegionWarning[]>;
}

/** public/data/meteoalarm-regions-hr.json (scripts/build-meteoalarm-regions.ts). */
export interface WarningRegionsFile {
	attribution: string;
	regions: Record<string, { name: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }>;
}

export interface SevereWeatherRegionProperties {
	/** NUTS 2021 level 3 code of the county. */
	id: string;
	regionName: string;
	warnings: RegionWarning[];
}

/** Map attribution for the warning layer: MeteoAlarm's terms ask for the
 *  source, GISCO's for the EuroGeographics credit on the county outlines. */
export const SEVERE_WEATHER_ATTRIBUTION =
	'Warnings: <a href="https://www.meteoalarm.org">MeteoAlarm</a> (EUMETNET), DHMZ, CC BY 4.0. Regions &copy; EuroGeographics';

/** In force now: started (or no start given) and not yet over (or no end given). */
export function warningIsCurrent(warning: RegionWarning, now: number): boolean {
	const from = Date.parse(warning.validFrom);
	const until = Date.parse(warning.validUntil);
	return (!Number.isFinite(from) || from <= now) && (!Number.isFinite(until) || until > now);
}

/** Over: its end time has passed. */
export function warningIsExpired(warning: RegionWarning, now: number): boolean {
	const until = Date.parse(warning.validUntil);
	return Number.isFinite(until) && until <= now;
}

export function highestSeverity(warnings: readonly RegionWarning[]): SeverityLevel | null {
	let best: SeverityLevel | null = null;
	for (const w of warnings) {
		if (!best || SEVERITY_ORDER[w.severity] > SEVERITY_ORDER[best]) best = w.severity;
	}
	return best;
}

/** The warnings a county feature carries; empty for anything malformed. */
export function regionWarnings(feature: GeoJSON.Feature): RegionWarning[] {
	const warnings = feature.properties?.warnings as unknown;
	return Array.isArray(warnings) ? (warnings as RegionWarning[]) : [];
}

/** One Feature per county with warnings, outlines from the regions file;
 *  codes the file does not know (a sea area, a new region) are skipped. */
export function joinWarningRegions(
	file: WarningRegionsFile,
	response: SevereWeatherResponse,
): GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, SevereWeatherRegionProperties> {
	const features: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, SevereWeatherRegionProperties>[] = [];
	for (const [code, warnings] of Object.entries(response.regions ?? {})) {
		const region = file.regions[code];
		if (!region || !Array.isArray(warnings) || warnings.length === 0) continue;
		features.push({
			type: 'Feature',
			id: code,
			geometry: region.geometry,
			properties: { id: code, regionName: region.name, warnings },
		});
	}
	return { type: 'FeatureCollection', features };
}
