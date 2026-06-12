/**
 * Water-source intelligence.
 *
 * Classifies OSM water POIs (amenity=drinking_water, natural=spring) into a
 * reliability class a thru-hiker can act on, and computes per-stage
 * dry-stretch stats for the multi-day planner. Shared between the enrichment
 * pipeline (scripts/enrich-pois.ts derives `Poi.water` from raw OSM tags at
 * dataset build time) and the runtime UI (markers, popup badge, list badge,
 * stage planner chips).
 *
 * Classification is deliberately conservative: an untagged spring is
 * "unverified" (treat before drinking, flow not guaranteed), never
 * "reliable". Only an explicit drinking_water=no demotes a source to
 * "not_potable"; only explicit seasonality flags make it "seasonal".
 */

import type { WaterInfo, WaterKind, WaterReliability } from './poi-types';

export type { WaterInfo, WaterKind, WaterReliability } from './poi-types';

/** Marker / badge colours per reliability class, as CSS custom property
 *  references so the light / dark palettes stay in theme.css. The "reliable"
 *  entry reuses the existing flat water colour. */
export const WATER_COLOR: Record<WaterReliability, string> = {
	reliable: 'var(--poi-color-water)',
	seasonal: 'var(--poi-color-water-seasonal)',
	unverified: 'var(--poi-color-water-unverified)',
	not_potable: 'var(--poi-color-water-nonpotable)',
};

function isTruthyTag(value: string | undefined): boolean {
	return value !== undefined && value !== 'no';
}

function normalizePotable(value: string | undefined): 'yes' | 'no' | 'conditional' | undefined {
	if (value === undefined) return undefined;
	if (value === 'yes') return 'yes';
	if (value === 'no') return 'no';
	// "conditional", "treated", "seasonal", ... - drinkable with caveats.
	return 'conditional';
}

/** Derives WaterInfo from raw OSM tags. Used by the enrichment pipeline. */
export function classifyWater(tags: Record<string, string>): WaterInfo {
	const kind: WaterKind = tags.natural === 'spring' ? 'spring' : 'tap';
	const seasonal = isTruthyTag(tags.seasonal);
	const intermittent = isTruthyTag(tags.intermittent);
	const potable = normalizePotable(tags.drinking_water);
	const checkRaw = tags['check_date'] ?? tags['survey:date'] ?? tags['check_date:drinking_water'];
	const checkDate = checkRaw && /^\d{4}-\d{2}-\d{2}/.test(checkRaw) ? checkRaw.slice(0, 10) : undefined;

	let reliability: WaterReliability;
	if (potable === 'no') {
		reliability = 'not_potable';
	} else if (seasonal || intermittent) {
		reliability = 'seasonal';
	} else if (kind === 'tap' || potable === 'yes') {
		// A mapped drinking-water tap is built infrastructure; a spring is only
		// "reliable" when a mapper explicitly confirmed drinking_water=yes.
		reliability = 'reliable';
	} else {
		reliability = 'unverified';
	}

	return {
		kind,
		reliability,
		...(seasonal && { seasonal: true }),
		...(intermittent && { intermittent: true }),
		...(potable && { potable }),
		...(checkDate && { checkDate }),
	};
}

/** Sources a hiker can plan around - everything except explicitly
 *  non-potable. Legacy dataset rows without `water` count as usable so the
 *  planner stat degrades gracefully until the next enrichment run. */
export function isUsableWaterSource(water: WaterInfo | undefined): boolean {
	return water ? water.reliability !== 'not_potable' : true;
}

export const WATER_RELIABILITY_OPTIONS = [
	'reliable',
	'seasonal',
	'unverified',
	'not_potable',
] as const satisfies readonly WaterReliability[];

/** Reliability class for a water POI; null for non-water rows. Legacy rows
 *  without `water` metadata are treated as unverified. */
export function poiWaterReliability(poi: { type: string; water?: WaterInfo }): WaterReliability | null {
	if (poi.type !== 'water') return null;
	return poi.water?.reliability ?? 'unverified';
}

/** Empty set = show all. When non-empty, water POIs must match a selected
 *  class; other POI types are unaffected. */
export function poiMatchesWaterReliabilityFilter(
	poi: { type: string; water?: WaterInfo },
	enabled: ReadonlySet<WaterReliability>,
): boolean {
	if (enabled.size === 0) return true;
	const rel = poiWaterReliability(poi);
	if (rel === null) return true;
	return enabled.has(rel);
}

/** Stage water chip turns amber at this dry stretch (km). */
export const WATER_GAP_WARN_KM = 15;
/** Stage water chip turns red at this dry stretch (km). */
export const WATER_GAP_DANGER_KM = 25;

/**
 * Longest stretch (km) of a [startKm, endKm] stage without passing a water
 * source. `sourceKms` are trail-km positions of usable sources (any order,
 * duplicates fine); the stage boundaries count as walls, so a stage with no
 * sources returns its full length.
 */
export function longestDryStretchKm(startKm: number, endKm: number, sourceKms: number[]): number {
	const lo = Math.min(startKm, endKm);
	const hi = Math.max(startKm, endKm);
	const inside = sourceKms.filter((k) => k >= lo && k <= hi).sort((a, b) => a - b);
	if (inside.length === 0) return hi - lo;
	let max = inside[0] - lo;
	for (let i = 1; i < inside.length; i++) {
		max = Math.max(max, inside[i] - inside[i - 1]);
	}
	return Math.max(max, hi - inside[inside.length - 1]);
}
