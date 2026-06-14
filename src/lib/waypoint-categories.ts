/**
 * Personal waypoint categories aligned with GPX 1.1 `<type>` / `<sym>` and common
 * hiking-app presets (Gaia GPS, OsmAnd, Garmin). Colors are distinct from curated
 * POI marker hues so user pins stay visually separate on the map.
 */

export const WAYPOINT_CATEGORY_IDS = [
	'generic',
	'camp',
	'water',
	'resupply',
	'viewpoint',
	'transport',
	'hazard',
] as const;

export type WaypointCategoryId = (typeof WAYPOINT_CATEGORY_IDS)[number];

export interface WaypointCategoryDef {
	id: WaypointCategoryId;
	/** Pin fill for Leaflet divIcon (inline style). */
	pinColor: string;
	/** GPX 1.1 `<type>` - human category string many apps read. */
	gpxType: string;
	/** GPX 1.1 `<sym>` - symbol name (Gaia-style where applicable). */
	gpxSym: string;
}

export const WAYPOINT_CATEGORIES: readonly WaypointCategoryDef[] = [
	{ id: 'generic', pinColor: '#7c3aed', gpxType: 'Waypoint', gpxSym: 'Waypoint' },
	{ id: 'camp', pinColor: '#16a34a', gpxType: 'Campsite', gpxSym: 'Campground' },
	{ id: 'water', pinColor: '#0284c7', gpxType: 'Water', gpxSym: 'Water Source' },
	{ id: 'resupply', pinColor: '#d97706', gpxType: 'Store', gpxSym: 'Resupply' },
	{ id: 'viewpoint', pinColor: '#0d9488', gpxType: 'Viewpoint', gpxSym: 'Scenic Area' },
	{ id: 'transport', pinColor: '#4f46e5', gpxType: 'Transportation', gpxSym: 'Parking Area' },
	{ id: 'hazard', pinColor: '#dc2626', gpxType: 'Hazard', gpxSym: 'Danger Area' },
] as const;

const BY_ID = new Map(WAYPOINT_CATEGORIES.map((c) => [c.id, c]));

export function normalizeWaypointCategory(value: string | undefined | null): WaypointCategoryId {
	if (value && (WAYPOINT_CATEGORY_IDS as readonly string[]).includes(value)) {
		return value as WaypointCategoryId;
	}
	return 'generic';
}

export function waypointCategoryDef(id: WaypointCategoryId | string | undefined | null): WaypointCategoryDef {
	return BY_ID.get(normalizeWaypointCategory(id)) ?? BY_ID.get('generic')!;
}

export function waypointCategoryPinColor(id: WaypointCategoryId | string | undefined | null): string {
	return waypointCategoryDef(id).pinColor;
}

/** Map imported GPX `<type>` and `<sym>` text to a CLDT category. */
export function gpxTextToWaypointCategory(type?: string, sym?: string): WaypointCategoryId {
	const hay = `${type ?? ''} ${sym ?? ''}`.toLowerCase();
	if (!hay.trim()) return 'generic';
	if (/danger|hazard|warning|avoid|closed|block/.test(hay)) return 'hazard';
	if (/camp|tent|bivouac|sleep|campground|campsite/.test(hay)) return 'camp';
	if (/resupply|store|shop|grocery|market|food|town|village/.test(hay)) return 'resupply';
	if (/water|spring|stream|well|tap|fountain|h2o/.test(hay)) return 'water';
	if (/view|scenic|lookout|photo|overlook|summit|peak/.test(hay)) return 'viewpoint';
	if (/transport|parking|bus|train|station|meet|car|taxi|ferry/.test(hay)) return 'transport';
	return 'generic';
}

/** Map curated POI type to a suggested personal waypoint category. */
export function poiTypeToSuggestedWaypointCategory(poiType: string): WaypointCategoryId {
	switch (poiType) {
		case 'hut':
		case 'shelter':
			return 'camp';
		case 'water':
			return 'water';
		case 'town':
		case 'settlement':
		case 'restaurant':
		case 'cafe':
		case 'food':
		case 'atm':
			return 'resupply';
		case 'viewpoint':
		case 'peak':
			return 'viewpoint';
		default:
			return 'generic';
	}
}

export function isWaypointCategoryVisible(
	category: WaypointCategoryId | string | undefined | null,
	hidden: ReadonlySet<WaypointCategoryId>,
): boolean {
	// Empty selection in "Show on map" means all visible; legacy persisted state
	// may have every category hidden from the old clear-all behavior.
	if (hidden.size === 0 || hidden.size >= WAYPOINT_CATEGORIES.length) return true;
	return !hidden.has(normalizeWaypointCategory(category));
}

export function buildWaypointPinHtml(categoryId: WaypointCategoryId | string | undefined | null): string {
	const color = waypointCategoryPinColor(categoryId);
	return (
		`<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);` +
		`background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);" aria-hidden="true"></div>`
	);
}
