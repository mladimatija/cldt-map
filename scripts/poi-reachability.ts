// Reachability filter for POIs (enricher Pass 6).
//
// Builds an OSM highway graph for the trail corridor and tests each POI for
// "can a hiker realistically walk here from the trail?" via two signals:
//
//   1. `nearestHighwayM` - straight-line distance from the POI to the closest
//      OSM `highway=*` way. A POI, far from any road/ path, is stranded by
//      definition regardless of haversine.
//   2. `isReachable` - is the POI's nearest road in the same connected
//      component of the highway graph as the trail polyline? Catches the
//      "0.5 km haversine but another side of an unbridged river" failure mode.
//
// Combined with per-type distance caps and a notability override (Wikipedia /
// Wikidata / population / elevation), the filter drops POIs that are
// "technically close" but practically unreachable, while preserving named
// peaks, towns with services, and curated trail destinations.
//
// All in one file, so the enricher imports a single helper; if this grows, it
// can split into geometry / graph / tiers, but at the current size colocation
// is easier to scan.

import { haversineDistanceM as haversineM } from '../src/lib/haversine';
import { fetchOverpass } from './overpass-fetch';

// ---- Types -----------------------------------------------------------------

interface LatLng {
	lat: number;
	lng: number;
}

interface Bbox {
	minLat: number;
	maxLat: number;
	minLng: number;
	maxLng: number;
}

interface OverpassWayElement {
	type: 'way';
	id: number;
	geometry?: { lat: number; lon: number }[];
	tags?: Record<string, string>;
}

interface OverpassResponse {
	elements: OverpassWayElement[];
}

/** Minimal POI shape this filter cares about. Matches the enricher's `Poi`
 *  interface field-by-field but we redeclare here, so this module doesn't
 *  depend on the rest of `enrich-pois.ts`. */
export interface ReachabilityPoi {
	id: string;
	type: string;
	name_en: string;
	name_hr: string;
	lat: number;
	lng: number;
	distanceFromTrailKm: number;
	population?: number | null;
	elevationM?: number | null;
	wikipedia?: string;
	source?: 'osm' | 'wikidata' | 'hps' | 'curated';
	nearestHighwayM?: number;
	isReachable?: boolean;
}

/** Per-type tier rule. Each POI type pulls its rule out of `TIER_RULES`
 *  below and runs through `passesTier`. */
interface TierRule {
	/** Hard ceiling - nothing escapes this even with notability. */
	maxOffTrailKm: number;
	/** POI must have an OSM `highway=*` within this many metres OR be
	 *  notable. Omit to skip the check. */
	requireRoadWithinM?: number;
	/** POI must have an OSM walking-grade way (path / track / footway) within
	 *  this many metres, OR be notable. Used for peaks where a service road
	 *  is meaningless. */
	requirePathWithinM?: number;
	/** POI's nearest highway must be in the trail-reachable connected
	 *  component, OR the POI is notable. */
	requireReachable?: boolean;
	/** Settlement-only: minimum population. Notability rescues. */
	requirePopulation?: number;
	/** Peak-only: POI must have a non-empty name. Notability rescues. */
	requireNamed?: boolean;
	/** `false` = no rescue. `true` = Wikipedia/Wikidata/population/elevation
	 *  rescues from road / path / reachable / population / named requirements
	 *  (but never from `maxOffTrailKm`). `'always'` = the POI type is
	 *  trail-relevant by definition (huts / shelters), and only the distance
	 *  cap applies. */
	notabilityOverride: boolean | 'always';
}

/** Per-type tier rules. Edit here to retune the filter. The matching column
 *  in the runtime / docs lives in src/lib/pois.ts. */
export const TIER_RULES: Record<string, TierRule> = {
	town: {
		maxOffTrailKm: 3,
		requireRoadWithinM: 100,
		requireReachable: true,
		notabilityOverride: true,
	},
	settlement: {
		maxOffTrailKm: 1.5,
		requireRoadWithinM: 50,
		requireReachable: true,
		requirePopulation: 100,
		notabilityOverride: true,
	},
	peak: {
		maxOffTrailKm: 10,
		requirePathWithinM: 200,
		requireNamed: true,
		notabilityOverride: true,
	},
	viewpoint: {
		maxOffTrailKm: 6,
		requireRoadWithinM: 100,
		requireReachable: true,
		notabilityOverride: true,
	},
	hut: {
		maxOffTrailKm: 15,
		notabilityOverride: 'always',
	},
	shelter: {
		maxOffTrailKm: 15,
		notabilityOverride: 'always',
	},
	food: {
		maxOffTrailKm: 2,
		requireRoadWithinM: 30,
		requireReachable: true,
		notabilityOverride: false,
	},
	atm: {
		maxOffTrailKm: 2,
		requireRoadWithinM: 30,
		requireReachable: true,
		notabilityOverride: false,
	},
};

// ---- Notability ------------------------------------------------------------

/** A POI qualifies as "notable" if any of:
 *   - It has a Wikipedia link (OSM `wikipedia=*` or matched via Wikidata).
 *   - It came from the Wikidata supplement pass (source === 'wikidata').
 *   - It's a settlement with a population >= 500.
 *   - It's a peak with elevation >= 1000 m.
 *
 *  Notability never overrides the per-type distance cap, only the road / path
 *  / reachability / population / named requirements. */
export function isNotable(poi: ReachabilityPoi): boolean {
	if (poi.wikipedia && poi.wikipedia.length > 0) return true;
	if (poi.source === 'wikidata') return true;
	if (poi.type === 'settlement' && (poi.population ?? 0) >= 500) return true;
	if (poi.type === 'peak' && (poi.elevationM ?? 0) >= 1000) return true;
	return false;
}

// ---- OSM highway graph -----------------------------------------------------

/** Walking-network filter for the Overpass highway query. Includes service
 *  roads and footpaths, so a POI on a hiking path snaps to something. Excludes
 *  freeways (hikers don't walk those) and `highway=construction` /
 *  `highway=proposed` (not yet usable). */
const HIGHWAY_REGEX =
	'motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track|path|footway|bridleway|cycleway|steps|pedestrian|living_street';

const OVERPASS_TIMEOUT_S = 240;
const FETCH_TIMEOUT_MS = 300_000;

/** Quantize a coordinate to a 5-decimal-place lattice (~1 m precision) so
 *  consecutive ways that share an endpoint at the same lat/lng land on the
 *  same graph node. Without this, floating-point drift between Overpass-
 *  reported coordinates fragments the graph. */
function quantize(lat: number, lng: number): string {
	return `${lat.toFixed(5)}:${lng.toFixed(5)}`;
}

interface Graph {
	/** Node id -> coordinate. Node ids are the quantized "lat:lng" string. */
	nodes: Map<string, LatLng>;
	/** Node id -> set of neighbor node ids. Undirected. */
	adj: Map<string, Set<string>>;
	/** Way kind for each node. A node may belong to multiple ways; we record
	 *  the strongest kind here, so the path-only path-proximity check works. */
	hasPath: Set<string>;
}

/** Fetches every `highway=*` way in the given bbox. Returns the ways with
 *  their full point geometry (Overpass `out geom;`). */
export async function fetchHighwaysInBbox(
	bbox: Bbox,
	overpassUrl: string,
	userAgent: string,
): Promise<OverpassWayElement[]> {
	const bboxStr = `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`;
	const query =
		`[out:json][timeout:${OVERPASS_TIMEOUT_S}];` + `way[highway~"^(${HIGHWAY_REGEX})$"](${bboxStr});` + `out geom;`;
	const res = await fetchOverpass({
		url: overpassUrl,
		body: `data=${encodeURIComponent(query)}`,
		userAgent,
		fetchTimeoutMs: FETCH_TIMEOUT_MS,
	});
	const data = (await res.json()) as OverpassResponse;
	return (data.elements ?? []).filter((e): e is OverpassWayElement => e.type === 'way');
}

/** Builds an undirected graph from Overpass way elements. Consecutive points
 *  in a way become adjacent nodes; nodes shared across ways are deduped via
 *  the `quantize()` key so the graph captures real intersections. */
export function buildHighwayGraph(ways: OverpassWayElement[]): Graph {
	const nodes = new Map<string, LatLng>();
	const adj = new Map<string, Set<string>>();
	const hasPath = new Set<string>();
	for (const way of ways) {
		if (!way.geometry || way.geometry.length < 2) continue;
		const isPath = isWalkingPath(way.tags?.highway);
		let prevKey: string | null = null;
		for (const pt of way.geometry) {
			const key = quantize(pt.lat, pt.lon);
			if (!nodes.has(key)) {
				nodes.set(key, { lat: pt.lat, lng: pt.lon });
				adj.set(key, new Set());
			}
			if (isPath) hasPath.add(key);
			if (prevKey !== null && prevKey !== key) {
				adj.get(prevKey)?.add(key);
				adj.get(key)?.add(prevKey);
			}
			prevKey = key;
		}
	}
	return { nodes, adj, hasPath };
}

/** True for OSM `highway=*` values that hikers actually walk. Peaks need to
 *  snap to one of these (a `service` road to a parking lot doesn't count
 *  for "is this peak reachable on foot"). */
function isWalkingPath(highway: string | undefined): boolean {
	if (!highway) return false;
	return (
		highway === 'path' ||
		highway === 'footway' ||
		highway === 'track' ||
		highway === 'bridleway' ||
		highway === 'steps' ||
		highway === 'pedestrian'
	);
}

/** Flood-fill the graph starting from every node within `seedRadiusM` of the
 *  trail polyline. Returns the set of node ids reachable along graph edges
 *  from any trail-seed node. */
export function floodFillFromTrail(graph: Graph, trailPts: LatLng[], seedRadiusM = 100): Set<string> {
	const reached = new Set<string>();
	const queue: string[] = [];
	// Seed: every node within seedRadiusM of the trail polyline. Using a
	// brute-force distance check because trail point counts are typically
	// in the low thousands and node counts in the tens of thousands; the
	// O(N*M) work is ~50ms in practice and avoids the complexity of a
	// trail-side spatial index for a one-shot enricher pass.
	for (const [id, node] of graph.nodes) {
		if (distanceToPolylineM(node, trailPts) <= seedRadiusM) {
			reached.add(id);
			queue.push(id);
		}
	}
	while (queue.length > 0) {
		const id = queue.shift()!;
		const neighbours = graph.adj.get(id);
		if (!neighbours) continue;
		for (const n of neighbours) {
			if (!reached.has(n)) {
				reached.add(n);
				queue.push(n);
			}
		}
	}
	return reached;
}

/** Minimum distance (metres) from a point to a polyline, computed as the
 *  smallest haversine to any vertex. For dense polylines (trkpts every
 *  ~10-50 m on a hiking GPX) this is a close approximation to the true
 *  perpendicular distance without the cost of segment-projection math. */
function distanceToPolylineM(point: LatLng, polyline: LatLng[]): number {
	let best = Infinity;
	for (const p of polyline) {
		const d = haversineM(point, p);
		if (d < best) best = d;
	}
	return best;
}

// ---- Spatial index ---------------------------------------------------------

/** Grid-based nearest-neighbor index over highway nodes. Cell size is the
 *  search radius, so a query touches at most 9 cells (the cell containing the
 *  query point + its 8 neighbors). Built once per enricher run. */
export class HighwayNodeIndex {
	private cells = new Map<string, { id: string; coord: LatLng }[]>();
	private cellLatDeg: number;
	private cellLngDeg: number;
	private hasPath: Set<string>;

	constructor(nodes: Map<string, LatLng>, hasPath: Set<string>, searchRadiusM = 300) {
		this.hasPath = hasPath;
		// Convert metres to degrees. Use the centroid latitude for longitude
		// scaling so cells stay near-square at the trail latitude.
		const latRad = nodes.size > 0 ? Array.from(nodes.values())[0].lat * (Math.PI / 180) : 0;
		this.cellLatDeg = searchRadiusM / 111_000;
		this.cellLngDeg = searchRadiusM / (111_000 * Math.cos(latRad));
		for (const [id, coord] of nodes) {
			const key = this.cellKey(coord.lat, coord.lng);
			const bucket = this.cells.get(key) ?? [];
			bucket.push({ id, coord });
			this.cells.set(key, bucket);
		}
	}

	private cellKey(lat: number, lng: number): string {
		const cellLat = Math.floor(lat / this.cellLatDeg);
		const cellLng = Math.floor(lng / this.cellLngDeg);
		return `${cellLat}:${cellLng}`;
	}

	/** Nearest node to `point`. Optionally restricted to nodes that touch a
	 *  walking-grade way (`pathOnly: true` for peaks). Returns null if the
	 *  3x3 cell search around `point` is empty. */
	nearest(point: LatLng, pathOnly: boolean): { id: string; coord: LatLng; distM: number } | null {
		const cellLat = Math.floor(point.lat / this.cellLatDeg);
		const cellLng = Math.floor(point.lng / this.cellLngDeg);
		let best: { id: string; coord: LatLng; distM: number } | null = null;
		for (let dLat = -1; dLat <= 1; dLat++) {
			for (let dLng = -1; dLng <= 1; dLng++) {
				const key = `${cellLat + dLat}:${cellLng + dLng}`;
				const bucket = this.cells.get(key);
				if (!bucket) continue;
				for (const entry of bucket) {
					if (pathOnly && !this.hasPath.has(entry.id)) continue;
					const d = haversineM(point, entry.coord);
					if (best === null || d < best.distM) {
						best = { id: entry.id, coord: entry.coord, distM: d };
					}
				}
			}
		}
		return best;
	}
}

// ---- Tier check ------------------------------------------------------------

export interface TierDrop {
	reason: 'distance' | 'population' | 'named' | 'road' | 'path' | 'reachable';
}

/** Apply the per-type tier rule. Returns `null` if the POI passes; an object
 *  with the failure `reason` if dropped. The reason is used purely for
 *  per-type drop tallies in the enricher log. */
export function checkTier(
	poi: ReachabilityPoi,
	rule: TierRule,
	nearestHighwayM: number,
	nearestPathM: number,
	isReachable: boolean,
): TierDrop | null {
	// Distance cap is the one rule notability cannot override.
	if (poi.distanceFromTrailKm > rule.maxOffTrailKm) return { reason: 'distance' };

	if (rule.notabilityOverride === 'always') return null;

	const notable = rule.notabilityOverride === true && isNotable(poi);

	// Population (settlements) - notability rescues.
	if (rule.requirePopulation && (poi.population ?? 0) < rule.requirePopulation && !notable) {
		return { reason: 'population' };
	}

	// Named (peaks) - notability rescues.
	if (rule.requireNamed && !(poi.name_en?.length || poi.name_hr?.length) && !notable) {
		return { reason: 'named' };
	}

	// Road proximity - notability rescues.
	if (rule.requireRoadWithinM !== undefined && nearestHighwayM > rule.requireRoadWithinM && !notable) {
		return { reason: 'road' };
	}

	// Path proximity (peaks) - notability rescues.
	if (rule.requirePathWithinM !== undefined && nearestPathM > rule.requirePathWithinM && !notable) {
		return { reason: 'path' };
	}

	// Reachability via connected component - notability rescues.
	if (rule.requireReachable && !isReachable && !notable) {
		return { reason: 'reachable' };
	}

	return null;
}

// ---- Top-level orchestrator ------------------------------------------------

export interface ReachabilityResult<T extends ReachabilityPoi> {
	/** POIs that passed all tier rules. Each carries a new ` nearestHighwayM `
	 *  + `isReachable` fields populated by this pass. */
	kept: T[];
	/** Per-type tally: kept vs. dropped (broken down by reason). */
	stats: Map<string, { kept: number; drops: Record<TierDrop['reason'], number> }>;
}

/** Top-level entry point. Fetches the highway corridor graph, computes
 *  reachability for every POI, applies tier rules, and returns the kept set
 *  with per-type drop tallies. Generic so callers passing a wider POI type
 *  (the enricher's full `Poi`) get the same wider type back without casts.
 *  Mutates the kept POIs to attach `nearestHighwayM` and `isReachable`. */
export async function applyReachabilityFilter<T extends ReachabilityPoi>(
	pois: T[],
	trailPts: LatLng[],
	bbox: Bbox,
	overpassUrl: string,
	userAgent: string,
): Promise<ReachabilityResult<T>> {
	console.log('-> Fetching OSM highway corridor for reachability check...');
	const ways = await fetchHighwaysInBbox(bbox, overpassUrl, userAgent);
	console.log(`     ${ways.length} highway ways.`);

	console.log('-> Building highway graph...');
	const graph = buildHighwayGraph(ways);
	console.log(`     ${graph.nodes.size} unique nodes, ${graph.hasPath.size} on walking paths.`);

	console.log('-> Flood-fill from trail polyline...');
	const reachable = floodFillFromTrail(graph, trailPts);
	console.log(`     ${reachable.size} nodes in trail-reachable component.`);

	console.log('-> Building spatial index...');
	const index = new HighwayNodeIndex(graph.nodes, graph.hasPath);

	console.log('-> Applying tier rules...');
	const kept: T[] = [];
	const stats = new Map<string, { kept: number; drops: Record<TierDrop['reason'], number> }>();
	const emptyDrops = (): Record<TierDrop['reason'], number> => ({
		distance: 0,
		population: 0,
		named: 0,
		road: 0,
		path: 0,
		reachable: 0,
	});

	for (const poi of pois) {
		const rule = TIER_RULES[poi.type];
		const tally = stats.get(poi.type) ?? { kept: 0, drops: emptyDrops() };

		// Unknown POI type? Keep unfiltered; tier rules only cover known types.
		if (!rule) {
			tally.kept++;
			stats.set(poi.type, tally);
			kept.push(poi);
			continue;
		}

		const nearest = index.nearest({ lat: poi.lat, lng: poi.lng }, false);
		const nearestPath = index.nearest({ lat: poi.lat, lng: poi.lng }, true);
		const nearestHighwayM = nearest?.distM ?? Infinity;
		const nearestPathM = nearestPath?.distM ?? Infinity;
		const isReachable = nearest ? reachable.has(nearest.id) : false;

		const drop = checkTier(poi, rule, nearestHighwayM, nearestPathM, isReachable);
		if (drop) {
			tally.drops[drop.reason]++;
			stats.set(poi.type, tally);
			continue;
		}

		// Attach reachability metadata for the schema-checked output.
		poi.nearestHighwayM = Number.isFinite(nearestHighwayM) ? Math.round(nearestHighwayM) : undefined;
		poi.isReachable = isReachable;
		tally.kept++;
		stats.set(poi.type, tally);
		kept.push(poi);
	}

	return { kept, stats };
}

/** Formats the per-type tally for a one-line-per-type log block. */
export function formatStats(stats: ReachabilityResult<ReachabilityPoi>['stats']): string {
	const lines: string[] = [];
	for (const [type, tally] of stats) {
		const drops = Object.entries(tally.drops)
			.filter(([, n]) => n > 0)
			.map(([k, n]) => `${k}=${n}`)
			.join(', ');
		lines.push(`  ${type}: kept ${tally.kept}${drops ? `, dropped (${drops})` : ''}`);
	}
	return lines.join('\n');
}
