/** Dependency-free POI type constants and interfaces.
 *
 *  This module is intentionally a leaf: it MUST NOT import from utils.ts,
 *  config.ts, or any module that transitively imports config.ts. Keeping it
 *  a leaf breaks the circular dependency that would otherwise arise because
 *  config.ts needs KNOWN_POI_TYPES while pois.ts (the previous home of these
 *  constants) imports isSafeUrl from utils.ts which in turn imports config.ts.
 */

/** All POI categories the v1 + Phase 2 renderer / settings recognise. The
 *  on-disk type field is intentionally open (any string), so future categories
 *  can be added without a schema migration - the renderer ignores unknown types
 *  and the settings panel grows a checkbox per known type. */
export type KnownPoiType =
	| 'town'
	| 'settlement'
	| 'peak'
	| 'viewpoint'
	| 'hut'
	| 'shelter'
	| 'restaurant'
	| 'cafe'
	/** Legacy "food" bucket - lumps restaurant + cafe + pub + fast_food. New
	 *  enrichments split into `restaurant`/`cafe`; this stays in the type set
	 *  so existing on-disk datasets continue to validate until they're
	 *  re-enriched. */
	| 'food'
	| 'atm'
	/** Drinking water: OSM amenity=drinking_water plus natural=spring. Rows
	 *  appear once the next scheduled enrichment run executes; until then the
	 *  type renders as an empty layer. */
	| 'water';

/** Canonical list of all known POI type values. Used as the single source
 *  of truth for default-enabled type sets in config.ts and stub.ts. */
export const KNOWN_POI_TYPES: readonly KnownPoiType[] = [
	'town',
	'settlement',
	'peak',
	'viewpoint',
	'hut',
	'shelter',
	'restaurant',
	'cafe',
	'food',
	'atm',
	'water',
] as const;

export type PoiType = KnownPoiType | string;

export interface PoiImage {
	/** Full-resolution image URL (typically a Commons file URL). */
	url: string;
	/** Pre-sized thumbnail URL (~600 px wide). Falls back to `url` when missing. */
	thumbUrl?: string;
	/** Human-readable credit line (e.g. "Photo by User:Foo"). Required for
	 *  CC-BY / CC-BY-SA content. */
	attribution?: string;
	/** Licence short code, e.g. "CC-BY-SA-4.0". */
	license?: string;
	/** Canonical page where the original file lives (Commons file page, etc.). */
	sourceUrl?: string;
}

export interface Poi {
	id: string;
	type: PoiType;
	name_en: string;
	name_hr: string;
	lat: number;
	lng: number;
	/** Cumulative SOBO km along the trail at the closest trail point. */
	trailKm: number;
	/** Great-circle distance from the POI to the closest trail point, in km.
	 *  0 means the trail passes through; larger values flag near-trail. */
	distanceFromTrailKm: number;
	population?: number | null;
	elevationM?: number | null;
	phone?: string;
	capacity?: number | null;
	season?: string;
	/** DEPRECATED legacy single image URL. Kept so older datasets keep working;
	 *  the renderer prefers `images[]` when present. */
	image?: string;
	/** Ordered photo gallery with attribution + licence metadata. The first
	 *  entry is the primary image. */
	images?: PoiImage[];
	wikipedia?: string;
	/** Wikipedia summary extracts baked at enrichment time (Phase 5). When
	 *  present, the popup renders them synchronously; when absent the
	 *  existing lazy-fetch path from `fetchWikipediaSummary` still runs. */
	summary_en?: string;
	summary_hr?: string;
	tags?: string[];
	url?: string;
	note_en?: string;
	note_hr?: string;
	/** Highest-quality data source the enricher recorded for this entry.
	 *  Order of precedence: `curated` > `hps` > `wikidata` > `osm`. The popup
	 *  renders a one-line provenance footer based on this field. */
	source?: 'osm' | 'wikidata' | 'hps' | 'curated';
	/** ISO date (YYYY-MM-DD) when the entry was last touched. */
	lastVerified?: string;
	/** Distance (metres) from the POI to the closest OSM `highway=*` way.
	 *  Set by the enricher's Pass 6 reachability filter. A small value means
	 *  the POI has a real road / path nearby; a large or absent value means
	 *  the POI is "stranded" (no OSM walking network within 300 m). */
	nearestHighwayM?: number;
	/** True if the POI's nearest highway is in the same connected component
	 *  of the OSM corridor highway graph as the trail polyline. False means
	 *  the road network around the POI is disconnected from the trail (the
	 *  classic "0.5 km haversine but other side of an unbridged river"
	 *  failure mode). Absent on POIs that predate Pass 6. */
	isReachable?: boolean;
}

export interface PoisFile {
	lastUpdated: string;
	pois: Poi[];
}

/** POI types grouped into settings categories for visual hygiene in the
 *  Layers cluster. The renderer is type-agnostic - only the Settings UI
 *  uses this grouping. */
export const POI_TYPE_GROUPS: readonly { id: string; types: readonly KnownPoiType[] }[] = [
	{ id: 'places', types: ['town', 'settlement'] },
	{ id: 'landscape', types: ['peak', 'viewpoint'] },
	{ id: 'stay', types: ['hut', 'shelter'] },
	{ id: 'services', types: ['restaurant', 'cafe', 'atm', 'water'] },
];

export function isKnownType(t: string): t is KnownPoiType {
	return (KNOWN_POI_TYPES as readonly string[]).includes(t);
}

/** Off-trail cap (km) at which a POI is still considered "in" a stage or
 *  nearby window. Shared by the stage planner panel, the trip-brief assembler,
 *  and any future feature that needs the same threshold so the values stay
 *  in sync automatically. */
export const STAGE_POI_OFFTRAIL_KM = 5;
