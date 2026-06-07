'use client';

import { useMemo } from 'react';
import { isKnownType, poiMatchesTagFilter, searchPoisByName, type Poi } from '@/lib/pois';
import { milesToKm, UnitSystem } from '@/lib/utils';
import { DistanceUnit, TrailDirection } from '@/lib/types';

/** Distance window (km) around a numeric jump-to query within which we surface
 *  nearby POIs in the list. */
const NEARBY_KM = 5;

export type SortMode = 'trail' | 'name' | 'offTrail' | 'gps';

export interface ParsedDistance {
	value: number;
	unit: DistanceUnit;
	soboKm: number;
}

/**
 * Parses a numeric query into a jump-to distance. Strict rules: must start
 * with a digit, optional decimal (comma or dot), optional km/mi suffix.
 * Returns null for anything else (text searches fall through to name match).
 */
function parseDistanceQuery(
	raw: string,
	activeUnits: UnitSystem,
	direction: TrailDirection,
	totalKm: number,
): ParsedDistance | null {
	const trimmed = raw.trim();
	if (trimmed.length === 0 || !/^[\d.,]/.test(trimmed)) return null;
	const match = /^([\d]+(?:[.,][\d]+)?)\s*(km|mi)?\s*$/i.exec(trimmed);
	if (!match) return null;
	const num = parseFloat(match[1].replace(',', '.'));
	if (!Number.isFinite(num) || num < 0) return null;
	const unitTyped = match[2]?.toLowerCase();
	const unit: DistanceUnit =
		unitTyped === 'mi' ? 'mi' : unitTyped === 'km' ? 'km' : activeUnits === 'imperial' ? 'mi' : 'km';
	const valueInKm = unit === 'mi' ? milesToKm(num) : num;
	if (valueInKm > totalKm + 0.5) return null;
	const soboKm = direction === 'SOBO' ? valueInKm : Math.max(0, totalKm - valueInKm);
	return { value: num, unit, soboKm };
}

export type PoiListGroupedItem =
	| { type: 'header'; key: string; label: string; count: number }
	| { type: 'poi'; key: string; poi: Poi; idx: number };

export interface UsePoiListRowsArgs {
	pois: Poi[] | null;
	enabledPoiTypes: ReadonlySet<string>;
	enabledPoiTags: ReadonlySet<string>;
	debouncedQuery: string;
	units: UnitSystem;
	direction: TrailDirection;
	trailTotalDistanceMeters: number | null;
	totalKm: number;
	sort: SortMode;
	locale: string;
	hasGps: boolean;
	gpsDistanceById: Map<string, number>;
	displayNameById: Map<string, string>;
	groupByDecade: boolean;
}

export interface UsePoiListRowsResult {
	parsedDistance: ParsedDistance | null;
	rows: Poi[];
	groupedItems: PoiListGroupedItem[] | null;
}

/**
 * Builds the filtered + sorted POI rows and (when grouping is active) the
 * decade-bucketed view. Extracted from MapControlsPoiList so the panel
 * component only owns presentation and event handling.
 */
export function usePoiListRows(args: UsePoiListRowsArgs): UsePoiListRowsResult {
	const {
		pois,
		enabledPoiTypes,
		enabledPoiTags,
		debouncedQuery,
		units,
		direction,
		trailTotalDistanceMeters,
		totalKm,
		sort,
		locale,
		hasGps,
		gpsDistanceById,
		displayNameById,
		groupByDecade,
	} = args;

	const parsedDistance = useMemo(
		() =>
			parseDistanceQuery(
				debouncedQuery,
				units,
				direction,
				// parseDistanceQuery's range guard works in km; trailTotalDistanceMeters
				// is in metres (Leaflet's distanceTo), so convert before passing.
				trailTotalDistanceMeters !== null ? trailTotalDistanceMeters / 1000 : totalKm,
			),
		[debouncedQuery, units, direction, trailTotalDistanceMeters, totalKm],
	);

	const rows = useMemo((): Poi[] => {
		if (!pois?.length) return [];
		const visible = pois.filter(
			(p) => isKnownType(p.type) && enabledPoiTypes.has(p.type) && poiMatchesTagFilter(p, enabledPoiTags),
		);
		const q = debouncedQuery.trim();
		// Numeric jump query: surface POIs within NEARBY_KM of the target.
		if (parsedDistance) {
			const target = parsedDistance.soboKm;
			return visible
				.filter((p) => Math.abs(p.trailKm - target) <= NEARBY_KM)
				.sort((a, b) => Math.abs(a.trailKm - target) - Math.abs(b.trailKm - target));
		}
		// Text query: name-search the type/tag-filtered pool. Falls back to the
		// full pool below if the query is empty.
		const pool = q.length > 0 ? searchPoisByName(visible, q, 200) : visible;
		// displayNameById is pre-computed by the caller; the comparator reads
		// from it to avoid O(N) poiDisplayName calls inside the sort.
		const cmp = (a: Poi, b: Poi): number => {
			if (sort === 'name') {
				return (displayNameById.get(a.id) ?? '').localeCompare(displayNameById.get(b.id) ?? '', locale);
			}
			if (sort === 'offTrail') {
				return a.distanceFromTrailKm - b.distanceFromTrailKm;
			}
			if (sort === 'gps' && hasGps) {
				// Fall back to +Infinity so anything missing a fix sinks to the bottom
				// instead of clustering at zero.
				const da = gpsDistanceById.get(a.id) ?? Number.POSITIVE_INFINITY;
				const db = gpsDistanceById.get(b.id) ?? Number.POSITIVE_INFINITY;
				return da - db;
			}
			// trail-km, direction-aware: NOBO walks the trail in reverse, so flip the
			// effective km used for sorting.
			const aKm = direction === 'SOBO' ? a.trailKm : totalKm - a.trailKm;
			const bKm = direction === 'SOBO' ? b.trailKm : totalKm - b.trailKm;
			return aKm - bKm;
		};
		return [...pool].sort(cmp);
	}, [
		debouncedQuery,
		displayNameById,
		parsedDistance,
		pois,
		enabledPoiTypes,
		enabledPoiTags,
		sort,
		locale,
		direction,
		totalKm,
		hasGps,
		gpsDistanceById,
	]);

	// When grouping is active, transform `rows` into alternating
	// `{ header, count }` and `{ poi }` entries the render can walk in a
	// single map(). Headers are direction-aware: the displayed range is
	// computed from the SOBO-keyed trailKm flipped to the user's direction.
	// Inactive grouping returns `null`; the render falls back to the flat list.
	const groupedItems = useMemo((): PoiListGroupedItem[] | null => {
		if (!groupByDecade || sort !== 'trail') return null;
		// Bucket size for decade grouping. 50 km in metric / 30 mi in imperial -
		// both render as round numbers in the user's active unit system. The km
		// value is the source of truth for bucketing math; the mi value drives
		// the imperial label and is converted back to km internally.
		const decadeValue = units === 'imperial' ? 30 : 50;
		const decadeKm = units === 'imperial' ? milesToKm(30) : 50;
		const decadeUnitLabel = units === 'imperial' ? 'mi' : 'km';
		const items: PoiListGroupedItem[] = [];
		// Single pass: push a header when the bucket changes, increment its
		// count for every row that lands in the same bucket. We hold the
		// current header reference in a local so subsequent rows don't have
		// to walk back through `items` to find it.
		let currentBucket = -1;
		let currentHeader: Extract<PoiListGroupedItem, { type: 'header' }> | null = null;
		for (let i = 0; i < rows.length; i++) {
			const poi = rows[i];
			const displayKm = direction === 'SOBO' ? poi.trailKm : Math.max(0, totalKm - poi.trailKm);
			const bucket = Math.floor(displayKm / decadeKm);
			if (bucket !== currentBucket) {
				currentBucket = bucket;
				const startVal = bucket * decadeValue;
				const endVal = startVal + decadeValue;
				currentHeader = {
					type: 'header',
					key: `header-${bucket}`,
					label: `${decadeUnitLabel} ${startVal} - ${endVal}`,
					count: 0,
				};
				items.push(currentHeader);
			}
			if (currentHeader) currentHeader.count++;
			items.push({ type: 'poi', key: poi.id, poi, idx: i });
		}
		return items;
	}, [groupByDecade, sort, rows, direction, totalKm, units]);

	return { parsedDistance, rows, groupedItems };
}
