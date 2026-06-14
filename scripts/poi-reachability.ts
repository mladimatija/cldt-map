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
//   3. Public transport escape - for towns / settlements / viewpoints, a
//      trail-side bus or train stop within a type-specific radius can rescue
//      a POI that fails the walking reachability check.
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
import {
	fetchOverpassJson,
	fetchPolylineWithBisection,
	overpassCacheFile,
	readOverpassJsonCache,
	writeOverpassJsonCache,
	type OverpassCacheOptions,
} from './overpass-fetch';

// ---- Types -----------------------------------------------------------------

interface LatLng {
	lat: number;
	lng: number;
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
	/** Straight-line distance (metres) to the nearest trail-side PT stop. */
	nearestPublicTransportM?: number;
	/** True when a trail-side bus/train stop is near enough to count as an
	 *  escape route even though walking reachability failed. */
	isReachableViaPublicTransport?: boolean;
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
	 *  component, OR the POI is notable, OR a trail-side PT stop is near enough. */
	requireReachable?: boolean;
	/** When true, a nearby trail-side bus/train stop can rescue a failed
	 *  walking reachability check (town / settlement / viewpoint only). */
	allowPublicTransportEscape?: boolean;
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
		allowPublicTransportEscape: true,
		notabilityOverride: true,
	},
	settlement: {
		maxOffTrailKm: 1.5,
		requireRoadWithinM: 50,
		requireReachable: true,
		allowPublicTransportEscape: true,
		requirePopulation: 100,
		notabilityOverride: true,
	},
	peak: {
		maxOffTrailKm: 2,
		requirePathWithinM: 200,
		requireNamed: true,
		notabilityOverride: true,
	},
	viewpoint: {
		maxOffTrailKm: 2,
		requireRoadWithinM: 100,
		requireReachable: true,
		allowPublicTransportEscape: true,
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
	water: {
		// No road/reachability requirement: a spring or tap reached only by
		// path is exactly what a thru-hiker needs. The 1 km hard cap matches
		// TYPE_CONFIGS in enrich-pois.ts.
		maxOffTrailKm: 1,
		notabilityOverride: false,
	},
};

/** A PT stop must sit within this many metres of a trail-reachable highway node. */
export const PT_TRAIL_SIDE_SNAP_M = 150;

/** Max straight-line distance from POI to a trail-side PT stop to count as escape. */
export const PT_POI_ESCAPE_MAX_M: Partial<Record<string, number>> = {
	town: 1500,
	settlement: 800,
	viewpoint: 1000,
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
 *  roads and footpaths, so a POI on a hiking path snaps to something. Omits
 *  motorway/trunk (not walkable; they dominate urban result sets without
 *  helping hiker reachability). Excludes `highway=construction` /
 *  `highway=proposed` (not yet usable). */
const HIGHWAY_REGEX =
	'primary|secondary|tertiary|unclassified|residential|service|track|path|footway|bridleway|cycleway|steps|pedestrian|living_street';

/** Must stay in sync with CORRIDOR_SAMPLE_STEP_KM / CORRIDOR_RADIUS_SLACK_KM in
 *  enrich-pois.ts - the corridor polyline step and the around-radius slack. */
const CORRIDOR_SAMPLE_STEP_KM = 2;
const CORRIDOR_RADIUS_SLACK_KM = 2;

/** Target trail length per highway Overpass slice. Pass 6 uses `out geom` (full
 *  way geometry), so each query is far heavier than Pass 1's `out center`.
 *  Urban stretches (Zagreb, Split) timed out at 12 fixed chunks x 6 km radius;
 *  ~8 km slices with bisection keep queries under the server [timeout:]. */
const HIGHWAY_CHUNK_TRAIL_KM = 8;

const HIGHWAY_OVERPASS_TIMEOUT_S = 120;
const HIGHWAY_FETCH_TIMEOUT_MS = 150_000;
const HIGHWAY_BISECT_MAX_DEPTH = 4;

const PT_OVERPASS_TIMEOUT_S = 180;
const PT_FETCH_TIMEOUT_MS = 200_000;

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

/** Split the downsampled corridor polyline into overlapping slices for
 *  independent Overpass queries. Overlap by one point catches ways spanning
 *  a boundary from at least one side. */
export function sliceCorridorIntoChunks(corridorPoly: LatLng[], chunkTrailKm = HIGHWAY_CHUNK_TRAIL_KM): LatLng[][] {
	const pointsPerChunk = Math.max(4, Math.round(chunkTrailKm / CORRIDOR_SAMPLE_STEP_KM) + 1);
	const chunks: LatLng[][] = [];
	if (corridorPoly.length < 2) return chunks;
	let start = 0;
	while (start < corridorPoly.length - 1) {
		const end = Math.min(corridorPoly.length, start + pointsPerChunk);
		chunks.push(corridorPoly.slice(start, end));
		if (end >= corridorPoly.length) break;
		start += pointsPerChunk - 1;
	}
	return chunks;
}

export interface HighwayFetchOptions {
	overpassUrl: string;
	fallbackUrls?: string[];
	userAgent: string;
	cache: OverpassCacheOptions;
}

async function fetchHighwayChunk(
	slice: LatLng[],
	label: string,
	radiusM: number,
	opts: HighwayFetchOptions,
): Promise<{ elements: OverpassWayElement[]; failed: boolean }> {
	return fetchPolylineWithBisection<OverpassWayElement>({
		slice,
		label,
		maxDepth: HIGHWAY_BISECT_MAX_DEPTH,
		onBisect: (bisectLabel, message) => console.warn(`     ${bisectLabel}: ${message}.`),
		run: async (runSlice, runLabel) => {
			const polyStr = runSlice.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(',');
			const query =
				`[out:json][timeout:${HIGHWAY_OVERPASS_TIMEOUT_S}];` +
				`way[highway~"^(${HIGHWAY_REGEX})$"](around:${radiusM},${polyStr});` +
				`out geom;`;
			const cacheFile = overpassCacheFile(opts.cache, runLabel, query);
			const cached = await readOverpassJsonCache<OverpassWayElement[]>(cacheFile, opts.cache);
			if (cached) {
				console.log(`     ${runLabel}: cache hit (${cached.length} ways).`);
				return cached;
			}
			const data = await fetchOverpassJson<OverpassResponse & { remark?: string }>({
				url: opts.overpassUrl,
				fallbackUrls: opts.fallbackUrls,
				body: `data=${encodeURIComponent(query)}`,
				userAgent: opts.userAgent,
				fetchTimeoutMs: HIGHWAY_FETCH_TIMEOUT_MS,
				maxAttempts: 2,
				onRetry: ({ message }) => console.warn(`     ${runLabel}: Overpass ${message}.`),
			});
			const elements = (data.elements ?? []).filter((e): e is OverpassWayElement => e.type === 'way');
			await writeOverpassJsonCache(cacheFile, elements, opts.cache);
			console.log(`     ${runLabel}: ${elements.length} ways.`);
			return elements;
		},
	});
}

function mergeHighwayWays(byId: Map<number, OverpassWayElement>, ways: OverpassWayElement[]): void {
	for (const way of ways) {
		byId.set(way.id, way);
	}
}

/**
 * Fetches every walking-relevant `highway=*` way along the trail corridor.
 * Strategy: slice the corridor into ~HIGHWAY_CHUNK_TRAIL_KM segments (much
 * finer than the old 12 equal splits), query each with `around:radius` and
 * `out geom`, and bisect any slice that still times out. Query timeouts do
 * not retry the same body (see overpass-fetch.ts); bisection splits instead.
 * Each leaf is cached on disk so reruns only refetch failed slices. When most
 * slices succeed but some fail, retries only the failed slices once before
 * applying partial results.
 */
export async function fetchHighwaysAlongCorridor(
	corridorPoly: LatLng[],
	radiusM: number,
	opts: HighwayFetchOptions,
): Promise<{ ways: OverpassWayElement[]; failed: boolean; failedLabels?: string[] }> {
	const byId = new Map<number, OverpassWayElement>();
	const failedLabels: string[] = [];
	let succeededChunks = 0;

	const chunks = sliceCorridorIntoChunks(corridorPoly);
	for (let c = 0; c < chunks.length; c++) {
		const slice = chunks[c];
		if (slice.length < 2) continue;

		const label = `highways - ${c + 1} of ${chunks.length}`;
		const result = await fetchHighwayChunk(slice, label, radiusM, opts);
		if (result.failed) failedLabels.push(label);
		else succeededChunks++;
		mergeHighwayWays(byId, result.elements);
	}

	if (failedLabels.length > 0 && succeededChunks > 0) {
		console.log(`  -> Retrying ${failedLabels.length} failed highway slice(s)...`);
		const stillFailed: string[] = [];
		for (const label of failedLabels) {
			const m = /^highways - (\d+) of \d+$/.exec(label);
			if (!m) {
				stillFailed.push(label);
				continue;
			}
			const c = parseInt(m[1], 10) - 1;
			const slice = chunks[c];
			if (!slice || slice.length < 2) {
				stillFailed.push(label);
				continue;
			}
			const result = await fetchHighwayChunk(slice, label, radiusM, opts);
			if (result.failed) {
				stillFailed.push(label);
			} else {
				mergeHighwayWays(byId, result.elements);
			}
		}
		return {
			ways: [...byId.values()],
			failed: stillFailed.length > 0,
			failedLabels: stillFailed,
		};
	}

	return {
		ways: [...byId.values()],
		failed: failedLabels.length > 0,
		...(failedLabels.length > 0 && { failedLabels }),
	};
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

	// Seed: every node within seedRadiusM of the trail polyline. The trail
	// points are bucketed into a uniform lat/lng grid (cell edge ~ the seed
	// radius) so each node only compares against the trail points in its 3x3
	// cell neighborhood. The previous brute-force version compared every node
	// against every trail point - fine for the tens-of-thousands-node graphs
	// it was written for, but a corridor graph of ~3M nodes against a 156k
	// point GPX is ~5e11 haversine calls (half a day of CPU).
	const cellLatDeg = seedRadiusM / 111_320;
	const midLatRad = trailPts.length > 0 ? (trailPts[0].lat * Math.PI) / 180 : 0.785;
	const cellLngDeg = seedRadiusM / (111_320 * Math.max(0.05, Math.cos(midLatRad)));
	const cells = new Map<string, LatLng[]>();
	for (const p of trailPts) {
		const key = `${Math.floor(p.lat / cellLatDeg)}:${Math.floor(p.lng / cellLngDeg)}`;
		const bucket = cells.get(key);
		if (bucket) bucket.push(p);
		else cells.set(key, [p]);
	}
	const nearTrail = (node: LatLng): boolean => {
		const latKey = Math.floor(node.lat / cellLatDeg);
		const lngKey = Math.floor(node.lng / cellLngDeg);
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				const bucket = cells.get(`${latKey + dy}:${lngKey + dx}`);
				if (!bucket) continue;
				for (const p of bucket) {
					if (haversineM(node, p) <= seedRadiusM) return true;
				}
			}
		}
		return false;
	};
	for (const [id, node] of graph.nodes) {
		if (nearTrail(node)) {
			reached.add(id);
			queue.push(id);
		}
	}

	// BFS with an index pointer: Array.shift() is O(n) per call and turns a
	// millions-node traversal quadratic.
	for (let head = 0; head < queue.length; head++) {
		const id = queue[head];
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

// ---- Public transport ------------------------------------------------------

interface OverpassNodeElement {
	type: 'node';
	id: number;
	lat: number;
	lon: number;
	tags?: Record<string, string>;
}

export interface PublicTransportStop {
	lat: number;
	lng: number;
	kind: 'bus' | 'train';
}

const PT_CHUNKS = 12;

function classifyPublicTransportKind(tags: Record<string, string> | undefined): 'bus' | 'train' | null {
	if (!tags) return null;
	if (tags.highway === 'bus_stop' || tags.amenity === 'bus_station') return 'bus';
	if (tags.railway === 'halt' || tags.railway === 'station') return 'train';
	return null;
}

/** Fetches bus and train stop nodes along the trail corridor. Non-fatal on
 *  failure: callers skip PT escape rescue when this returns `failed: true`. */
export async function fetchPublicTransportAlongCorridor(
	corridorPoly: LatLng[],
	radiusM: number,
	opts: HighwayFetchOptions,
): Promise<{ stops: PublicTransportStop[]; failed: boolean }> {
	const byId = new Map<number, PublicTransportStop>();
	let failed = false;
	const chunkSize = Math.ceil(corridorPoly.length / PT_CHUNKS);

	for (let c = 0; c < PT_CHUNKS; c++) {
		const start = Math.max(0, c * chunkSize - 1);
		const slice = corridorPoly.slice(start, (c + 1) * chunkSize);
		if (slice.length < 2) continue;

		const result = await fetchPolylineWithBisection<OverpassNodeElement>({
			slice,
			label: `pt - ${c + 1} of ${PT_CHUNKS}`,
			onBisect: (label, message) => console.warn(`     ${label}: ${message}.`),
			run: async (runSlice, label) => {
				const polyStr = runSlice.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(',');
				const query =
					`[out:json][timeout:${PT_OVERPASS_TIMEOUT_S}];` +
					`(` +
					`node["highway"="bus_stop"](around:${radiusM},${polyStr});` +
					`node["amenity"="bus_station"](around:${radiusM},${polyStr});` +
					`node["railway"~"^(halt|station)$"](around:${radiusM},${polyStr});` +
					`);` +
					`out body;`;
				const cacheFile = overpassCacheFile(opts.cache, label, query);
				const cached = await readOverpassJsonCache<OverpassNodeElement[]>(cacheFile, opts.cache);
				if (cached) {
					console.log(`     ${label}: cache hit (${cached.length} PT nodes).`);
					return cached;
				}
				const data = await fetchOverpassJson<{ elements: OverpassNodeElement[]; remark?: string }>({
					url: opts.overpassUrl,
					fallbackUrls: opts.fallbackUrls,
					body: `data=${encodeURIComponent(query)}`,
					userAgent: opts.userAgent,
					fetchTimeoutMs: PT_FETCH_TIMEOUT_MS,
					onRetry: ({ message }) => console.warn(`     ${label}: Overpass ${message}.`),
				});
				const elements = (data.elements ?? []).filter((e): e is OverpassNodeElement => e.type === 'node');
				await writeOverpassJsonCache(cacheFile, elements, opts.cache);
				console.log(`     ${label}: ${elements.length} PT nodes.`);
				return elements;
			},
		});
		if (result.failed) failed = true;
		for (const node of result.elements) {
			const kind = classifyPublicTransportKind(node.tags);
			if (!kind) continue;
			byId.set(node.id, { lat: node.lat, lng: node.lon, kind });
		}
	}

	return { stops: [...byId.values()], failed };
}

/** Keeps PT stops that sit on the trail-reachable highway network. */
export function findTrailSidePublicTransportStops(
	stops: PublicTransportStop[],
	index: HighwayNodeIndex,
	reachable: Set<string>,
	snapM = PT_TRAIL_SIDE_SNAP_M,
): PublicTransportStop[] {
	const trailSide: PublicTransportStop[] = [];
	for (const stop of stops) {
		const nearest = index.nearest({ lat: stop.lat, lng: stop.lng }, false);
		if (!nearest || nearest.distM > snapM) continue;
		if (!reachable.has(nearest.id)) continue;
		trailSide.push(stop);
	}
	return trailSide;
}

/** Grid index over trail-side PT stops for nearest-neighbour lookup. */
export class PublicTransportIndex {
	private cells = new Map<string, PublicTransportStop[]>();
	private cellLatDeg: number;
	private cellLngDeg: number;

	constructor(stops: PublicTransportStop[], searchRadiusM: number) {
		const latRad = stops.length > 0 ? (stops[0].lat * Math.PI) / 180 : 0;
		this.cellLatDeg = searchRadiusM / 111_000;
		this.cellLngDeg = searchRadiusM / (111_000 * Math.cos(latRad));
		for (const stop of stops) {
			const key = this.cellKey(stop.lat, stop.lng);
			const bucket = this.cells.get(key) ?? [];
			bucket.push(stop);
			this.cells.set(key, bucket);
		}
	}

	private cellKey(lat: number, lng: number): string {
		return `${Math.floor(lat / this.cellLatDeg)}:${Math.floor(lng / this.cellLngDeg)}`;
	}

	nearest(point: LatLng): { stop: PublicTransportStop; distM: number } | null {
		const cellLat = Math.floor(point.lat / this.cellLatDeg);
		const cellLng = Math.floor(point.lng / this.cellLngDeg);
		let best: { stop: PublicTransportStop; distM: number } | null = null;
		for (let dLat = -1; dLat <= 1; dLat++) {
			for (let dLng = -1; dLng <= 1; dLng++) {
				const bucket = this.cells.get(`${cellLat + dLat}:${cellLng + dLng}`);
				if (!bucket) continue;
				for (const stop of bucket) {
					const d = haversineM(point, stop);
					if (best === null || d < best.distM) {
						best = { stop, distM: d };
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
	ptEscapeValid = false,
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

	// Reachability via connected component - notability or PT escape rescues.
	if (rule.requireReachable && !isReachable && !notable) {
		const ptRescue = rule.allowPublicTransportEscape === true && ptEscapeValid;
		if (!ptRescue) return { reason: 'reachable' };
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
	/** Types whose graph-dependent rules (road / path / reachable) could not
	 *  be evaluated because the highway graph failed to build. Their fresh
	 *  rows are withheld from `kept`; the caller must carry forward the prior
	 *  dataset's rows for these types (the same mechanism as Pass 1 failures)
	 *  instead of dropping or blindly keeping unverified data. */
	carryForwardTypes: Set<string>;
}

/** True when evaluating this rule requires the highway graph. */
function ruleNeedsGraph(rule: TierRule): boolean {
	if (rule.notabilityOverride === 'always') return false;
	return rule.requireRoadWithinM !== undefined || rule.requirePathWithinM !== undefined || !!rule.requireReachable;
}

/** Top-level entry point. Fetches the highway corridor graph, computes
 *  reachability for every POI, applies tier rules, and returns the kept set
 *  with per-type drop tallies. Generic so callers passing a wider POI type
 *  (the enricher's full `Poi`) get the same wider type back without casts.
 *  Mutates the kept POIs to attach `nearestHighwayM` and `isReachable`. */
export async function applyReachabilityFilter<T extends ReachabilityPoi>(
	pois: T[],
	trailPts: LatLng[],
	corridorPoly: LatLng[],
	opts: HighwayFetchOptions,
): Promise<ReachabilityResult<T>> {
	// Radius covers the farthest off-trail POI of any GRAPH-DEPENDENT rule,
	// plus CORRIDOR_RADIUS_SLACK_KM (same slack Pass 1 uses for its around:
	// queries). Rules that never consult the graph (notabilityOverride
	// 'always', e.g. huts at 15 km) must not widen the ribbon: deriving the
	// radius from all rules once produced an 18 km ribbon whose chunks blew the
	// Overpass server timeout on both endpoints, when the road checks
	// themselves only ever look ~3 km off trail.
	const maxOffTrailKm = Math.max(
		...Object.values(TIER_RULES)
			.filter((r) => ruleNeedsGraph(r))
			.map((r) => r.maxOffTrailKm),
	);
	const radiusM = Math.round((maxOffTrailKm + CORRIDOR_RADIUS_SLACK_KM) * 1000);
	const highwayChunks = sliceCorridorIntoChunks(corridorPoly).length;

	// Partial runs (e.g. POI_TYPES=water) can arrive with no POI whose rule
	// ever consults the graph. The corridor fetch, flood fill, and spatial
	// index would be pure waste then - skip straight to the tier loop with an
	// empty graph; the graph-free rules below only check distance / name /
	// population.
	const graphNeeded = pois.some((p) => {
		const rule = TIER_RULES[p.type];
		return rule !== undefined && ruleNeedsGraph(rule);
	});

	let ways: Awaited<ReturnType<typeof fetchHighwaysAlongCorridor>>['ways'] = [];
	let highwayFailedLabels: string[] = [];
	if (graphNeeded) {
		console.log(
			`-> Fetching OSM highway corridor for reachability check (~${HIGHWAY_CHUNK_TRAIL_KM} km slices, ${highwayChunks} chunks, r=${radiusM} m)...`,
		);
		const res = await fetchHighwaysAlongCorridor(corridorPoly, radiusM, opts);
		ways = res.ways;
		highwayFailedLabels = res.failedLabels ?? [];
		console.log(
			`     ${ways.length} highway ways${res.failed ? ` (${highwayFailedLabels.length} slice(s) still failed)` : ''}.`,
		);
	} else {
		console.log('-> No graph-dependent POI types in this run - skipping highway corridor fetch.');
	}

	console.log('-> Building highway graph...');
	const graph = buildHighwayGraph(ways);
	console.log(`     ${graph.nodes.size} unique nodes, ${graph.hasPath.size} on walking paths.`);

	// A failed chunk leaves a regional hole in the graph, but when most slices
	// succeeded we still use the partial graph rather than discarding all
	// highway data. Only a completely empty graph (every slice failed) triggers
	// carry-forward for graph-dependent types.
	const graphUnusable = graphNeeded && graph.nodes.size === 0;
	const carryForwardTypes = new Set<string>();
	if (graphUnusable) {
		for (const [type, rule] of Object.entries(TIER_RULES)) {
			if (ruleNeedsGraph(rule)) carryForwardTypes.add(type);
		}
		console.warn(
			`     highway graph unusable - carrying forward prior rows for graph-dependent types: ${[...carryForwardTypes].join(', ')}.`,
		);
	} else if (highwayFailedLabels.length > 0) {
		const okSlices = highwayChunks - highwayFailedLabels.length;
		console.warn(
			`     ${highwayFailedLabels.length} highway slice(s) failed after retry; using partial graph (${graph.nodes.size} nodes from ${okSlices} slices). ` +
				`Re-run ENRICH_FROM_PASS=6 to retry: ${highwayFailedLabels.join(', ')}`,
		);
	}

	// Flood-fill and the spatial index only serve graph-dependent checks;
	// when those types are being carried forward anyway, skip both (on a
	// multi-million-node partial graph they are minutes of wasted work).
	let reachable = new Set<string>();
	let index: HighwayNodeIndex | null = null;
	let ptIndex: PublicTransportIndex | null = null;
	if (graphNeeded && !graphUnusable) {
		console.log('-> Flood-fill from trail polyline...');
		reachable = floodFillFromTrail(graph, trailPts);
		console.log(`     ${reachable.size} nodes in trail-reachable component.`);

		console.log('-> Building spatial index...');
		index = new HighwayNodeIndex(graph.nodes, graph.hasPath);

		console.log('-> Fetching public transport stops for escape-route signals...');
		const ptRes = await fetchPublicTransportAlongCorridor(corridorPoly, radiusM, opts);
		if (ptRes.failed) {
			console.warn('     PT fetch had failures - skipping public-transport escape rescue.');
		} else {
			const trailSide = findTrailSidePublicTransportStops(ptRes.stops, index, reachable);
			console.log(`     ${trailSide.length} trail-side PT stops (of ${ptRes.stops.length} total).`);
			const maxSearchM = Math.max(
				0,
				...Object.values(PT_POI_ESCAPE_MAX_M).filter((v): v is number => typeof v === 'number'),
			);
			if (trailSide.length > 0 && maxSearchM > 0) {
				ptIndex = new PublicTransportIndex(trailSide, maxSearchM);
			}
		}
	}

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

		// Graph-dependent type while the graph is unusable: withhold the fresh
		// row; the caller carries the prior dataset's row forward instead.
		if (carryForwardTypes.has(poi.type)) continue;

		// index is null only when the graph is unusable, and then every type
		// reaching this point has a graph-free rule whose checks ignore these.
		const nearest = index ? index.nearest({ lat: poi.lat, lng: poi.lng }, false) : null;
		const nearestPath = index ? index.nearest({ lat: poi.lat, lng: poi.lng }, true) : null;
		const nearestHighwayM = nearest?.distM ?? Infinity;
		const nearestPathM = nearestPath?.distM ?? Infinity;
		const isReachable = nearest ? reachable.has(nearest.id) : false;

		const ptMaxM = PT_POI_ESCAPE_MAX_M[poi.type];
		const ptNearest = ptIndex?.nearest({ lat: poi.lat, lng: poi.lng }) ?? null;
		const ptEscapeValid =
			rule.allowPublicTransportEscape === true &&
			ptMaxM !== undefined &&
			ptNearest !== null &&
			ptNearest.distM <= ptMaxM;

		const drop = checkTier(poi, rule, nearestHighwayM, nearestPathM, isReachable, ptEscapeValid);
		if (drop) {
			tally.drops[drop.reason]++;
			stats.set(poi.type, tally);
			continue;
		}

		// Attach reachability metadata for the schema-checked output. Skipped
		// entirely when the corridor fetch was skipped: writing isReachable
		// false from a graph nothing was checked against would be a lie.
		if (index) {
			poi.nearestHighwayM = Number.isFinite(nearestHighwayM) ? Math.round(nearestHighwayM) : undefined;
			poi.isReachable = isReachable;
		}
		if (ptEscapeValid && ptNearest) {
			poi.nearestPublicTransportM = Math.round(ptNearest.distM);
			poi.isReachableViaPublicTransport = true;
		}
		tally.kept++;
		stats.set(poi.type, tally);
		kept.push(poi);
	}

	return { kept, stats, carryForwardTypes };
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
