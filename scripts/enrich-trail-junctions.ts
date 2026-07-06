// Enriches public/data/trail-junctions.json with OSM route relations
// (route=hiking/foot) that branch off the CLDT.
//
// Run: `npm run enrich-junctions`
// Optionally set OSM_OVERPASS_URL to a self-hosted instance.
//
// TEMPER FRAMING: every hit is "the marked trail that branches off here",
// keyed on the OSM name / ref / osmc:symbol / network of the branching route
// relation. This is NOT an authoritative HPS Registar lookup - HPS route
// numbers are unreliable in OSM - so the dataset credits OpenStreetMap and the
// UI never presents a ref as an official trail identifier.
//
// Flow:
//   1. Fetch GPX, parse trkpts, compute cumulative km + a spatial grid.
//   2. Chunk the trail into ~10 km x 10 km bboxes.
//   3. For each chunk: query Overpass for route=hiking/foot relations in the
//      bbox plus the full geometry of their member ways.
//   4. Merge relations + way geometry across chunks (a relation spanning a
//      chunk boundary is returned whole from whichever chunk selects it).
//   5. For each relation, EXCLUDING the CLDT's own route relation, find the
//      nearest approach of any member way node to the CLDT. If it is within the
//      snap radius, record ONE junction at that nearest-approach km with the
//      relation's name/ref/network/osmc:symbol, an off-trail bearing, and a
//      proximity class.
//   6. Validate against trail-junctions.schema.json.
//   7. Write public/data/trail-junctions.json and print a summary.
//
// Imports use relative '../src/lib/...' paths (not the '@/lib/...' alias) so the
// script runs under tsx; distance-utils is deliberately NOT imported because its
// transitive '@/lib/store/types' alias does not resolve here - the great-circle
// bearing is computed inline below.

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineDistanceM as haversineM, type LatLng } from '../src/lib/haversine';
import {
	fetchOverpass,
	overpassCacheFile,
	readOverpassJsonCache,
	writeOverpassJsonCache,
	type OverpassCacheOptions,
} from './overpass-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SCHEMA_PATH = path.resolve(PROJECT_ROOT, 'public/trail-junctions.schema.json');
const OUTPUT_PATH = path.resolve(PROJECT_ROOT, 'public/data/trail-junctions.json');
const GPX_URL = process.env.NEXT_PUBLIC_GPX_URL;
const OVERPASS_URL = process.env.OSM_OVERPASS_URL?.trim() || 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'cldt-junctions-enricher/1.0 (+https://cldt.hr)';

// Maximum bbox dimension (km) per Overpass query. Larger = fewer requests but
// more data (and more timeout risk). Matches the OSM tag enricher.
const CHUNK_BBOX_KM = 10;

// Maximum distance (m) from a branching way to the CLDT before it is considered
// "not a junction". 50 m absorbs GPS/OSM discrepancies; the same radius the OSM
// tag enricher snaps with. Tighter drops poorly mapped junctions; looser starts
// attributing trails that merely run parallel nearby.
const SNAP_RADIUS_M = 50;

// A branching trail whose nearest approach is within this many metres is treated
// as actually meeting the CLDT ("crosses"); farther but still within the snap
// radius is "near".
const CROSS_THRESHOLD_M = 12;

// How far along the branching way (m) to look for the reference node used to
// compute the off-trail bearing. Far enough to shrug off local wiggle, near
// enough to describe the direction it leaves the junction.
const OFF_BEARING_SPAN_M = 120;

// Grid cell size (deg) for the CLDT vertex index. ~0.02 deg ~ 2.2 km, far larger
// than any GPX inter-trkpt segment, so a 3x3 neighbourhood never misses a
// segment within the snap radius.
const GRID_CELL_DEG = 0.02;

// Per-request Overpass timeout (server-side, seconds).
const OVERPASS_TIMEOUT_S = 90;

// Per-request HTTP timeout (ms).
const FETCH_TIMEOUT_MS = 120_000;

// Pause between chunks to stay a good citizen on the public Overpass instance.
const CHUNK_DELAY_MS = 1_500;

// On-disk Overpass cache so a rerun after a partial failure only refetches the
// chunks that actually missed.
const CACHE_DIR = path.resolve(PROJECT_ROOT, '.overpass-cache/trail-junctions');
const cacheOpts: OverpassCacheOptions = {
	dir: CACHE_DIR,
	ttlMs: 7 * 24 * 60 * 60 * 1000,
	disabled: process.env.OVERPASS_NO_CACHE === '1',
};

// ---- CLDT self-exclusion matcher -------------------------------------------
// CRITICAL CORRECTNESS GUARD. The CLDT is itself an OSM hiking route relation.
// Every one of its member ways snaps to the trail at ~0 m, so without excluding
// it we would emit a spurious "junction" for the trail branching off itself at
// effectively every km. HPS route numbers (ref) are unreliable in OSM, so we
// deliberately match on the relation's NAME text rather than its ref: OSM tags
// the CLDT with an English name containing "Croatian Long Distance Trail"
// (sometimes abbreviated CLDT) and a Croatian long-distance name. Extend the
// patterns here if the relation is renamed upstream.
const CLDT_SELF_NAME_PATTERNS: RegExp[] = [
	/croatian long distance trail/i,
	/\bcldt\b/i,
	/hrvatska planinarska obilaznica/i, // Croatian "long distance hiking loop" naming sometimes reused
	/prijesosna transverzala/i,
];
/** Name-carrying tags checked against the self-exclusion patterns. */
const NAME_TAG_KEYS = ['name', 'name:en', 'name:hr', 'official_name', 'alt_name'] as const;

function isCldtSelfRelation(tags: Record<string, string>): boolean {
	for (const key of NAME_TAG_KEYS) {
		const value = tags[key];
		if (value && CLDT_SELF_NAME_PATTERNS.some((re) => re.test(value))) return true;
	}
	return false;
}

// ---- Types -----------------------------------------------------------------

interface CumPoint extends LatLng {
	km: number;
}

interface OsmRelation {
	id: number;
	tags: Record<string, string>;
	memberWayIds: number[];
}

interface OutputJunction {
	trailKm: number;
	name?: string;
	ref?: string;
	network?: string;
	osmcSymbol?: string;
	offBearingDeg?: number;
	proximity?: string;
}

interface OutputFile {
	lastUpdated: string;
	totalKm: number;
	source: string;
	junctions: OutputJunction[];
}

interface OverpassElement {
	type?: string;
	id?: number;
	tags?: Record<string, string>;
	geometry?: Array<{ lat: number; lon: number }>;
	members?: Array<{ type?: string; ref?: number; role?: string }>;
}

interface OverpassJson {
	elements?: OverpassElement[];
	remark?: string;
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
	if (!GPX_URL) fail('NEXT_PUBLIC_GPX_URL is required in env.');

	console.log('-> Fetching GPX...');
	const gpx = await fetchText(GPX_URL);
	const trkpts = parseTrkpts(gpx);
	if (trkpts.length < 2) fail('GPX has fewer than 2 trkpts; aborting.');
	console.log(`  ${trkpts.length} trkpts.`);

	console.log('-> Computing cumulative distances...');
	const points = computeCumPoints(trkpts);
	const totalKm = points[points.length - 1].km;
	console.log(`  Total trail: ${totalKm.toFixed(1)} km.`);

	console.log('-> Building spatial grid...');
	const grid = buildGrid(points);

	console.log('-> Chunking trail for Overpass...');
	const chunks = chunkByBbox(points, CHUNK_BBOX_KM);
	console.log(`  ${chunks.length} chunks of <= ${CHUNK_BBOX_KM} km bbox.`);

	// Merge relations + way geometry across chunks.
	const relationsById = new Map<number, OsmRelation>();
	const wayGeom = new Map<number, LatLng[]>();

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		console.log(`-> Chunk ${i + 1}/${chunks.length} (${chunk.length} pts)...`);
		const json = await fetchRelationsInBbox(bboxOf(chunk));
		let relCount = 0;
		let wayCount = 0;
		for (const el of json.elements ?? []) {
			if (el.type === 'relation' && typeof el.id === 'number' && el.tags) {
				const memberWayIds = (el.members ?? [])
					.filter((m) => m.type === 'way' && typeof m.ref === 'number')
					.map((m) => m.ref as number);
				const existing = relationsById.get(el.id);
				if (existing) {
					for (const w of memberWayIds) if (!existing.memberWayIds.includes(w)) existing.memberWayIds.push(w);
				} else {
					relationsById.set(el.id, { id: el.id, tags: el.tags, memberWayIds });
				}
				relCount++;
			} else if (el.type === 'way' && typeof el.id === 'number' && el.geometry) {
				if (!wayGeom.has(el.id)) {
					wayGeom.set(
						el.id,
						el.geometry.map((g) => ({ lat: g.lat, lng: g.lon })),
					);
					wayCount++;
				}
			}
		}
		console.log(`     ${relCount} relations, ${wayCount} new member ways.`);
		if (i < chunks.length - 1) await sleep(CHUNK_DELAY_MS);
	}

	console.log(`-> ${relationsById.size} unique route relations. Snapping to CLDT...`);
	const junctions: OutputJunction[] = [];
	let excludedSelf = 0;
	for (const relation of relationsById.values()) {
		if (isCldtSelfRelation(relation.tags)) {
			excludedSelf++;
			continue;
		}
		const junction = snapRelationToTrail(relation, wayGeom, points, grid);
		if (junction) junctions.push(junction);
	}
	junctions.sort((a, b) => a.trailKm - b.trailKm);
	console.log(`  ${junctions.length} junctions recorded (${excludedSelf} CLDT-self relation(s) excluded).`);

	const output: OutputFile = {
		lastUpdated: isoDate(new Date()),
		totalKm: Math.round(totalKm * 10) / 10,
		source: 'OpenStreetMap (route=hiking/foot)',
		junctions,
	};

	console.log('-> Validating schema...');
	const schema = JSON.parse(await fs.readFile(SCHEMA_PATH, 'utf8'));
	const ajv = new Ajv({ strict: false, allErrors: true });
	addFormats(ajv);
	const validate = ajv.compile(schema);
	if (!validate(output)) {
		console.error('Schema validation failed:');
		for (const err of validate.errors ?? []) console.error(`  ${err.instancePath} ${err.message}`);
		process.exit(1);
	}

	console.log('-> Writing output...');
	await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, '\t') + '\n', 'utf8');

	const networkHistogram = histogram(junctions, (j) => j.network ?? null);
	console.log('\nJunctions by network:');
	for (const [k, v] of networkHistogram) console.log(`  ${k ?? '(untagged)'}: ${v}`);
	const named = junctions.filter((j) => j.name).length;
	console.log(`\n${named}/${junctions.length} junctions carry an OSM name.`);
	console.log('\nDone. Review with `git diff public/data/trail-junctions.json` and open a PR.');
}

// ---- Snapping --------------------------------------------------------------

interface NearestTrail {
	distM: number;
	km: number;
}

/**
 * Nearest approach of a relation (any of its member way nodes) to the CLDT.
 * Returns a junction when within the snap radius, else null. The junction km is
 * the CLDT km of the nearest point; the off-bearing points along the branching
 * way away from the trail.
 */
function snapRelationToTrail(
	relation: OsmRelation,
	wayGeom: Map<number, LatLng[]>,
	points: CumPoint[],
	grid: Grid,
): OutputJunction | null {
	let best: { distM: number; km: number; wayNodes: LatLng[]; nodeIdx: number } | null = null;
	for (const wayId of relation.memberWayIds) {
		const nodes = wayGeom.get(wayId);
		if (!nodes || nodes.length === 0) continue;
		for (let n = 0; n < nodes.length; n++) {
			const nearest = nearestTrailPoint(nodes[n], points, grid);
			if (nearest && (!best || nearest.distM < best.distM)) {
				best = { distM: nearest.distM, km: nearest.km, wayNodes: nodes, nodeIdx: n };
			}
		}
	}
	if (!best || best.distM > SNAP_RADIUS_M) return null;

	const tags = relation.tags;
	const junction: OutputJunction = {
		trailKm: Math.round(best.km * 1000) / 1000,
		proximity: best.distM <= CROSS_THRESHOLD_M ? 'crosses' : 'near',
	};
	const name = tags.name ?? tags['name:hr'] ?? tags['name:en'];
	if (name) junction.name = name;
	if (tags.ref) junction.ref = tags.ref;
	if (tags.network) junction.network = tags.network;
	if (tags['osmc:symbol']) junction.osmcSymbol = tags['osmc:symbol'];

	const bearing = offTrailBearing(best.wayNodes, best.nodeIdx, points, grid);
	if (bearing !== null) junction.offBearingDeg = Math.round(bearing * 10) / 10;

	return junction;
}

/**
 * Direction (deg CW from north) the branching way heads as it leaves the CLDT.
 * Walks ~OFF_BEARING_SPAN_M along the way from the contact node in each
 * direction, then takes the bearing toward whichever reference node ends up
 * farther from the trail (the branch clearly heading off-trail).
 */
function offTrailBearing(wayNodes: LatLng[], contactIdx: number, points: CumPoint[], grid: Grid): number | null {
	if (wayNodes.length < 2) return null;
	const contact = wayNodes[contactIdx];

	const refInDirection = (step: 1 | -1): LatLng | null => {
		let acc = 0;
		let prev = contact;
		for (let i = contactIdx + step; i >= 0 && i < wayNodes.length; i += step) {
			acc += haversineM(prev, wayNodes[i]);
			prev = wayNodes[i];
			if (acc >= OFF_BEARING_SPAN_M) return wayNodes[i];
		}
		// Ran off the end of the way before hitting the span: use the endpoint if
		// we actually moved.
		return prev !== contact ? prev : null;
	};

	const fwd = refInDirection(1);
	const bwd = refInDirection(-1);
	const candidates = [fwd, bwd].filter((c): c is LatLng => c !== null);
	if (candidates.length === 0) return null;

	// Pick the reference that lands farthest from the CLDT so the bearing
	// describes the branch heading off-trail, not the segment running along it.
	let refNode = candidates[0];
	let refDist = nearestTrailPoint(refNode, points, grid)?.distM ?? 0;
	for (let i = 1; i < candidates.length; i++) {
		const d = nearestTrailPoint(candidates[i], points, grid)?.distM ?? 0;
		if (d > refDist) {
			refDist = d;
			refNode = candidates[i];
		}
	}
	return bearingDeg(contact, refNode);
}

/** Initial great-circle bearing (deg, 0-360 CW from north) from a to b.
 *  Inlined here rather than importing distance-utils (its '@/lib' alias does
 *  not resolve under tsx). */
function bearingDeg(a: LatLng, b: LatLng): number {
	const rad = Math.PI / 180;
	const phi1 = a.lat * rad;
	const phi2 = b.lat * rad;
	const dLng = (b.lng - a.lng) * rad;
	const y = Math.sin(dLng) * Math.cos(phi2);
	const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
	return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ---- Spatial grid over CLDT vertices ---------------------------------------

type Grid = Map<string, number[]>;

function cellKey(lat: number, lng: number): string {
	return `${Math.floor(lat / GRID_CELL_DEG)}:${Math.floor(lng / GRID_CELL_DEG)}`;
}

function buildGrid(points: CumPoint[]): Grid {
	const grid: Grid = new Map();
	for (let i = 0; i < points.length; i++) {
		const key = cellKey(points[i].lat, points[i].lng);
		const bucket = grid.get(key);
		if (bucket) bucket.push(i);
		else grid.set(key, [i]);
	}
	return grid;
}

/** Nearest point on the CLDT polyline to p (segment projection), using the grid
 *  to gather candidate vertices from the 3x3 cell neighbourhood. Returns null
 *  when no CLDT vertex sits in the neighbourhood (p is far from the trail). */
function nearestTrailPoint(p: LatLng, points: CumPoint[], grid: Grid): NearestTrail | null {
	const baseLat = Math.floor(p.lat / GRID_CELL_DEG);
	const baseLng = Math.floor(p.lng / GRID_CELL_DEG);
	const seen = new Set<number>();
	let best: NearestTrail | null = null;
	for (let dLat = -1; dLat <= 1; dLat++) {
		for (let dLng = -1; dLng <= 1; dLng++) {
			const bucket = grid.get(`${baseLat + dLat}:${baseLng + dLng}`);
			if (!bucket) continue;
			for (const idx of bucket) {
				// Evaluate the two segments adjacent to each candidate vertex once.
				for (const seg of [idx - 1, idx]) {
					if (seg < 0 || seg >= points.length - 1 || seen.has(seg)) continue;
					seen.add(seg);
					const result = pointToSegment(p, points[seg], points[seg + 1]);
					if (!best || result.distM < best.distM) best = result;
				}
			}
		}
	}
	return best;
}

/** Projects p onto segment [a,b], returns metric distance and interpolated CLDT
 *  km at the projection. Works in an equirectangular local frame - accurate at
 *  the sub-kilometre segment scale. */
function pointToSegment(p: LatLng, a: CumPoint, b: CumPoint): NearestTrail {
	const rad = Math.PI / 180;
	const kx = Math.cos(p.lat * rad) * 111_320;
	const ky = 111_320;
	const ax = (a.lng - p.lng) * kx;
	const ay = (a.lat - p.lat) * ky;
	const bx = (b.lng - p.lng) * kx;
	const by = (b.lat - p.lat) * ky;
	const dx = bx - ax;
	const dy = by - ay;
	const lenSq = dx * dx + dy * dy;
	let t = lenSq === 0 ? 0 : -(ax * dx + ay * dy) / lenSq;
	t = Math.max(0, Math.min(1, t));
	const px = ax + t * dx;
	const py = ay + t * dy;
	return {
		distM: Math.sqrt(px * px + py * py),
		km: a.km + t * (b.km - a.km),
	};
}

// ---- GPX parsing + cumulative km -------------------------------------------

function parseTrkpts(gpx: string): LatLng[] {
	const pts: LatLng[] = [];
	const re = /<trkpt\b[^>]*\blat="([\d.-]+)"[^>]*\blon="([\d.-]+)"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(gpx)) !== null) {
		const lat = parseFloat(m[1]);
		const lng = parseFloat(m[2]);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
		if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
		pts.push({ lat, lng });
	}
	return pts;
}

function computeCumPoints(pts: LatLng[]): CumPoint[] {
	const out: CumPoint[] = [{ ...pts[0], km: 0 }];
	let cumM = 0;
	for (let i = 1; i < pts.length; i++) {
		cumM += haversineM(pts[i - 1], pts[i]);
		out.push({ ...pts[i], km: cumM / 1000 });
	}
	return out;
}

// ---- Bbox chunking ---------------------------------------------------------

interface Bbox {
	minLat: number;
	maxLat: number;
	minLng: number;
	maxLng: number;
}

function bboxOf(points: LatLng[]): Bbox {
	let minLat = Infinity,
		maxLat = -Infinity,
		minLng = Infinity,
		maxLng = -Infinity;
	for (const p of points) {
		if (p.lat < minLat) minLat = p.lat;
		if (p.lat > maxLat) maxLat = p.lat;
		if (p.lng < minLng) minLng = p.lng;
		if (p.lng > maxLng) maxLng = p.lng;
	}
	return { minLat, maxLat, minLng, maxLng };
}

function bboxSpansKm(b: Bbox): { latKm: number; lngKm: number } {
	const latKm = (b.maxLat - b.minLat) * 111;
	const meanLat = (b.maxLat + b.minLat) / 2;
	const lngKm = (b.maxLng - b.minLng) * 111 * Math.cos((meanLat * Math.PI) / 180);
	return { latKm, lngKm };
}

function chunkByBbox(points: CumPoint[], maxKm: number): CumPoint[][] {
	const chunks: CumPoint[][] = [];
	let current: CumPoint[] = [];
	let bbox: Bbox | null = null;
	for (const s of points) {
		if (bbox === null) {
			current.push(s);
			bbox = { minLat: s.lat, maxLat: s.lat, minLng: s.lng, maxLng: s.lng };
			continue;
		}
		const tentative: Bbox = {
			minLat: Math.min(bbox.minLat, s.lat),
			maxLat: Math.max(bbox.maxLat, s.lat),
			minLng: Math.min(bbox.minLng, s.lng),
			maxLng: Math.max(bbox.maxLng, s.lng),
		};
		const { latKm, lngKm } = bboxSpansKm(tentative);
		if (latKm > maxKm || lngKm > maxKm) {
			chunks.push(current);
			current = [s];
			bbox = { minLat: s.lat, maxLat: s.lat, minLng: s.lng, maxLng: s.lng };
		} else {
			current.push(s);
			bbox = tentative;
		}
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

// ---- Overpass query --------------------------------------------------------

async function fetchRelationsInBbox(b: Bbox): Promise<OverpassJson> {
	// Pad the bbox by the snap radius so a relation whose nodes sit just outside
	// the chunk can still be matched to an edge sample.
	const padDeg = SNAP_RADIUS_M / 111_000;
	const meanLat = ((b.maxLat + b.minLat) / 2) * (Math.PI / 180);
	const padLng = padDeg / Math.max(0.1, Math.cos(meanLat));
	const bboxStr = `${b.minLat - padDeg},${b.minLng - padLng},${b.maxLat + padDeg},${b.maxLng + padLng}`;
	// rel[route=hiking|foot](bbox); out body (tags + member list); way(r) recurses
	// to the member ways; out geom returns their full geometry.
	const query =
		`[out:json][timeout:${OVERPASS_TIMEOUT_S}];` +
		`rel[route~"^(hiking|foot)$"](${bboxStr});` +
		`out body;` +
		`way(r);` +
		`out geom;`;

	const cacheFile = overpassCacheFile(cacheOpts, 'chunk', query);
	const cached = await readOverpassJsonCache<OverpassJson>(cacheFile, cacheOpts);
	if (cached) {
		console.log('     (cache hit)');
		return cached;
	}

	let json: OverpassJson;
	try {
		const res = await fetchOverpass({
			url: OVERPASS_URL,
			body: `data=${encodeURIComponent(query)}`,
			userAgent: USER_AGENT,
			fetchTimeoutMs: FETCH_TIMEOUT_MS,
			onRetry: ({ message }) => console.warn(`     Overpass ${message}.`),
		});
		json = (await res.json()) as OverpassJson;
	} catch (err) {
		console.warn(`     Overpass error: ${(err as Error).message}; treating chunk as empty.`);
		return { elements: [] };
	}
	if (typeof json.remark === 'string' && /error/i.test(json.remark)) {
		console.warn(`     Overpass remark: ${json.remark}; treating chunk as empty.`);
		return { elements: [] };
	}
	await writeOverpassJsonCache(cacheFile, json, cacheOpts);
	return json;
}

// ---- Small helpers ---------------------------------------------------------

async function fetchText(url: string): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: controller.signal });
		if (!res.ok) fail(`Fetch ${url} returned HTTP ${res.status}.`);
		return await res.text();
	} finally {
		clearTimeout(timeout);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function isoDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function histogram(
	junctions: OutputJunction[],
	key: (j: OutputJunction) => string | null,
): Array<[string | null, number]> {
	const counts = new Map<string | null, number>();
	for (const j of junctions) {
		const k = key(j);
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function fail(msg: string): never {
	console.error(`X ${msg}`);
	process.exit(1);
}

main().catch((err) => {
	console.error('Enrichment failed:', err);
	process.exit(1);
});
