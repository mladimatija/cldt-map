// Regenerate when NEXT_PUBLIC_GPX_URL changes or to refresh OSM data.
// Always commit the regenerated road-access.json - the runtime ships the bundled file.
// public/data/hgss-stations.json is hand-curated; edit it directly.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineDistanceM } from '../src/lib/haversine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Configuration ---------------------------------------------------------

// Overpass QL regex (not a JS RegExp) - interpolated into the highway~"…" filter.
const ROAD_HIGHWAY_FILTER = 'primary|secondary|tertiary|trunk|motorway|residential|unclassified';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OUTPUT_PATH = path.resolve(__dirname, '..', 'public', 'data', 'road-access.json');

const DEDUPE_RADIUS_M = 150;
const TRAIL_BBOX_CHUNK_KM = 50;
const OVERPASS_PAUSE_MS = 1500;
const OVERPASS_RETRY_DELAYS_MS = [10_000, 30_000];
const OVERPASS_MAX_ATTEMPTS = OVERPASS_RETRY_DELAYS_MS.length + 1;
const OVERPASS_MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
const BBOX_PAD_DEG = 0.005; // ~ 550 m padding around each chunk

// ---- Types -----------------------------------------------------------------

interface LatLng {
	lat: number;
	lng: number;
}

interface TrailPoint extends LatLng {
	cumKm: number;
}

interface BBox {
	south: number;
	west: number;
	north: number;
	east: number;
}

interface OverpassWay {
	type: 'way';
	id: number;
	tags?: Record<string, string>;
	geometry?: { lat: number; lon: number }[];
}

interface OverpassResponse {
	elements: OverpassWay[];
}

interface RoadAccessEntry {
	lat: number;
	lng: number;
	trailKm: number;
	roadRef: string;
}

interface Crossing {
	lat: number;
	lng: number;
	trailKm: number;
	roadRef: string;
}

// ---- Utilities -------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const haversineKm = (a: LatLng, b: LatLng): number => haversineDistanceM(a, b) / 1000;

// ---- GPX loading -----------------------------------------------------------

async function fetchTrailGpx(): Promise<string> {
	const url = process.env.NEXT_PUBLIC_GPX_URL;
	if (!url) {
		throw new Error(
			'NEXT_PUBLIC_GPX_URL is not set. Re-run with: ' +
				'NEXT_PUBLIC_GPX_URL="https://…/trail.gpx" npm run build:emergency-data',
		);
	}
	const parsed = new URL(url);
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		throw new Error(`NEXT_PUBLIC_GPX_URL must use http(s); got ${parsed.protocol}`);
	}
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Failed to fetch GPX: HTTP ${res.status} ${res.statusText}`);
	}
	return await res.text();
}

function extractTrkPoints(xml: string): LatLng[] {
	// Mirror gpx-parser.ts safety: reject DOCTYPE to prevent entity-expansion DoS.
	if (/<!DOCTYPE/i.test(xml)) {
		throw new Error('GPX file contains unsupported DOCTYPE');
	}
	const points: LatLng[] = [];
	const re = /<trkpt\s+lat="(-?\d{1,3}(?:\.\d{1,15})?)"\s+lon="(-?\d{1,3}(?:\.\d{1,15})?)"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml)) !== null) {
		const lat = parseFloat(m[1]);
		const lng = parseFloat(m[2]);
		if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
			points.push({ lat, lng });
		}
	}
	return points;
}

function buildCumulativeKm(points: LatLng[]): TrailPoint[] {
	const out: TrailPoint[] = [];
	let cum = 0;
	for (let i = 0; i < points.length; i++) {
		if (i > 0) cum += haversineKm(points[i - 1], points[i]);
		out.push({ lat: points[i].lat, lng: points[i].lng, cumKm: cum });
	}
	return out;
}

// ---- Chunk planning --------------------------------------------------------

function chunkBboxesAlongTrail(
	points: TrailPoint[],
	chunkKm: number,
): { bbox: BBox; startIdx: number; endIdx: number }[] {
	const chunks: { bbox: BBox; startIdx: number; endIdx: number }[] = [];
	if (points.length < 2) return chunks;

	let startIdx = 0;
	let chunkStartKm = points[0].cumKm;

	for (let i = 1; i < points.length; i++) {
		const reachedChunk = points[i].cumKm - chunkStartKm >= chunkKm;
		const isLast = i === points.length - 1;
		if (reachedChunk || isLast) {
			const slice = points.slice(startIdx, i + 1);
			chunks.push({
				bbox: bboxOf(slice, BBOX_PAD_DEG),
				startIdx,
				endIdx: i,
			});
			startIdx = i;
			chunkStartKm = points[i].cumKm;
		}
	}
	return chunks;
}

function bboxOf(pts: LatLng[], padDeg: number): BBox {
	let south = Infinity;
	let west = Infinity;
	let north = -Infinity;
	let east = -Infinity;
	for (const p of pts) {
		if (p.lat < south) south = p.lat;
		if (p.lat > north) north = p.lat;
		if (p.lng < west) west = p.lng;
		if (p.lng > east) east = p.lng;
	}
	return {
		south: south - padDeg,
		west: west - padDeg,
		north: north + padDeg,
		east: east + padDeg,
	};
}

// ---- Overpass --------------------------------------------------------------

// Stream the body and abort once the cap is exceeded - Content-Length is
// optional and server-controlled, so a header check alone can't enforce limits.
async function readBodyWithCap(res: Response, cap: number): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) throw new Error('Overpass response body missing');
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > cap) {
			await reader.cancel();
			throw new Error(`Overpass response exceeded ${cap} bytes`);
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString('utf-8');
}

async function queryOverpassChunk(bbox: BBox): Promise<OverpassWay[]> {
	const query = `[out:json][timeout:25];
way[highway~"${ROAD_HIGHWAY_FILTER}"]
  (${bbox.south},${bbox.west},${bbox.north},${bbox.east});
out geom;`;
	const body = `data=${encodeURIComponent(query)}`;

	let lastErr: unknown = null;

	for (let attempt = 0; attempt < OVERPASS_MAX_ATTEMPTS; attempt++) {
		try {
			const res = await fetch(OVERPASS_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'User-Agent': 'cldt-map build-emergency-data (https://github.com/mladimatija/cldt-map)',
					Accept: 'application/json',
				},
				body,
			});
			if (!res.ok) {
				throw new Error(`Overpass HTTP ${res.status} ${res.statusText}`);
			}
			const text = await readBodyWithCap(res, OVERPASS_MAX_RESPONSE_BYTES);
			const json = JSON.parse(text) as OverpassResponse;
			return json.elements.filter((e) => e.type === 'way');
		} catch (err) {
			lastErr = err;
			const delay = OVERPASS_RETRY_DELAYS_MS[attempt];
			if (delay !== undefined) {
				console.warn(
					`  Overpass request failed (attempt ${attempt + 1}/${OVERPASS_MAX_ATTEMPTS}): ${
						(err as Error).message
					}. Retrying in ${delay / 1000}s…`,
				);
				await sleep(delay);
			}
		}
	}
	throw new Error(`Overpass request failed after ${OVERPASS_MAX_ATTEMPTS} attempts: ${(lastErr as Error).message}`);
}

// ---- Geometry --------------------------------------------------------------

interface Segment {
	a: LatLng;
	b: LatLng;
}

interface TrailSegment extends Segment {
	startKm: number;
	endKm: number;
}

interface RoadSegment extends Segment {
	roadRef: string;
}

function buildTrailSegments(points: TrailPoint[]): TrailSegment[] {
	const segs: TrailSegment[] = [];
	for (let i = 1; i < points.length; i++) {
		segs.push({
			a: { lat: points[i - 1].lat, lng: points[i - 1].lng },
			b: { lat: points[i].lat, lng: points[i].lng },
			startKm: points[i - 1].cumKm,
			endKm: points[i].cumKm,
		});
	}
	return segs;
}

function assembleRoadSegments(ways: OverpassWay[]): RoadSegment[] {
	const segs: RoadSegment[] = [];
	for (const way of ways) {
		const geom = way.geometry;
		if (!geom || geom.length < 2) continue;
		const tags = way.tags ?? {};
		// Fall back to highway tag value (e.g. 'residential', 'unclassified') so the
		// label is at least descriptive when the way has no ref or name.
		const roadRef = tags.ref ?? tags.name ?? tags.highway ?? 'road';
		for (let i = 1; i < geom.length; i++) {
			segs.push({
				a: { lat: geom[i - 1].lat, lng: geom[i - 1].lon },
				b: { lat: geom[i].lat, lng: geom[i].lon },
				roadRef,
			});
		}
	}
	return segs;
}

// Planar segment-segment intersection in lat/lng. At Croatia latitudes over a
// single OSM way segment (typically <100m) the planar approximation error is
// well below the 150m dedupe radius.
function intersect(p: LatLng, p2: LatLng, q: LatLng, q2: LatLng): { lat: number; lng: number; t: number } | null {
	const r = { x: p2.lng - p.lng, y: p2.lat - p.lat };
	const s = { x: q2.lng - q.lng, y: q2.lat - q.lat };
	const denom = r.x * s.y - r.y * s.x;
	// Epsilon guard: nearly-parallel segments produce numerically unstable t/u.
	if (Math.abs(denom) < 1e-12) return null;
	const dx = q.lng - p.lng;
	const dy = q.lat - p.lat;
	const t = (dx * s.y - dy * s.x) / denom;
	const u = (dx * r.y - dy * r.x) / denom;
	if (t < 0 || t > 1 || u < 0 || u > 1) return null;
	return {
		lat: p.lat + t * r.y,
		lng: p.lng + t * r.x,
		t,
	};
}

// Spatial grid keyed by floor(lat*1000), floor(lng*1000) - roughly 110m × 80m
// cells at Croatia latitudes. Each road segment is registered into every cell
// its bbox overlaps.
function buildRoadGrid(roads: RoadSegment[]): Map<string, RoadSegment[]> {
	const grid = new Map<string, RoadSegment[]>();
	for (const seg of roads) {
		const minLat = Math.min(seg.a.lat, seg.b.lat);
		const maxLat = Math.max(seg.a.lat, seg.b.lat);
		const minLng = Math.min(seg.a.lng, seg.b.lng);
		const maxLng = Math.max(seg.a.lng, seg.b.lng);
		const i0 = Math.floor(minLat * 1000);
		const i1 = Math.floor(maxLat * 1000);
		const j0 = Math.floor(minLng * 1000);
		const j1 = Math.floor(maxLng * 1000);
		for (let i = i0; i <= i1; i++) {
			for (let j = j0; j <= j1; j++) {
				const key = `${i},${j}`;
				let bucket = grid.get(key);
				if (!bucket) {
					bucket = [];
					grid.set(key, bucket);
				}
				bucket.push(seg);
			}
		}
	}
	return grid;
}

function findIntersections(trailSegments: TrailSegment[], roads: RoadSegment[]): Crossing[] {
	const grid = buildRoadGrid(roads);
	const crossings: Crossing[] = [];

	for (const ts of trailSegments) {
		const minLat = Math.min(ts.a.lat, ts.b.lat);
		const maxLat = Math.max(ts.a.lat, ts.b.lat);
		const minLng = Math.min(ts.a.lng, ts.b.lng);
		const maxLng = Math.max(ts.a.lng, ts.b.lng);
		const i0 = Math.floor(minLat * 1000);
		const i1 = Math.floor(maxLat * 1000);
		const j0 = Math.floor(minLng * 1000);
		const j1 = Math.floor(maxLng * 1000);

		for (let i = i0; i <= i1; i++) {
			for (let j = j0; j <= j1; j++) {
				const bucket = grid.get(`${i},${j}`);
				if (!bucket) continue;
				for (const rs of bucket) {
					const hit = intersect(ts.a, ts.b, rs.a, rs.b);
					if (!hit) continue;
					const trailKm = ts.startKm + hit.t * (ts.endKm - ts.startKm);
					crossings.push({
						lat: hit.lat,
						lng: hit.lng,
						trailKm,
						roadRef: rs.roadRef,
					});
				}
			}
		}
	}
	return crossings;
}

// ---- Dedupe & label --------------------------------------------------------

function dedupeCrossings(crossings: Crossing[]): Crossing[] {
	const sorted = [...crossings].sort((a, b) => a.trailKm - b.trailKm);
	const kept: Crossing[] = [];
	const radiusKm = DEDUPE_RADIUS_M / 1000;

	for (const c of sorted) {
		const dup = kept.some((k) => k.roadRef === c.roadRef && haversineKm(k, c) < radiusKm);
		if (!dup) kept.push(c);
	}
	return kept;
}

function toEntries(crossings: Crossing[]): RoadAccessEntry[] {
	return crossings.map((c) => ({
		// 6 decimal places ~ 11 cm precision, ample for an emergency map pin.
		lat: Number(c.lat.toFixed(6)),
		lng: Number(c.lng.toFixed(6)),
		trailKm: Number(c.trailKm.toFixed(3)),
		roadRef: c.roadRef,
	}));
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
	console.log('[1/5] Fetching trail GPX…');
	const xml = await fetchTrailGpx();

	console.log('[2/5] Parsing trail points…');
	const rawPoints = extractTrkPoints(xml);
	if (rawPoints.length < 2) {
		throw new Error(`Expected >=2 trail points; got ${rawPoints.length}`);
	}
	const trail = buildCumulativeKm(rawPoints);
	const trailSegments = buildTrailSegments(trail);
	console.log(`     → ${trail.length} points, ${trail[trail.length - 1].cumKm.toFixed(1)} km total`);

	console.log('[3/5] Planning Overpass chunks…');
	const chunks = chunkBboxesAlongTrail(trail, TRAIL_BBOX_CHUNK_KM);
	console.log(`     → ${chunks.length} chunks (~${TRAIL_BBOX_CHUNK_KM} km each)`);

	console.log('[4/5] Fetching OSM road geometry & finding intersections…');
	const allCrossings: Crossing[] = [];
	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		console.log(
			`     [chunk ${i + 1}/${chunks.length}] bbox=${chunk.bbox.south.toFixed(3)},${chunk.bbox.west.toFixed(3)},${chunk.bbox.north.toFixed(3)},${chunk.bbox.east.toFixed(3)}`,
		);
		const ways = await queryOverpassChunk(chunk.bbox);
		const roadSegs = assembleRoadSegments(ways);
		const chunkTrail = trailSegments.slice(chunk.startIdx, chunk.endIdx);
		const crossings = findIntersections(chunkTrail, roadSegs);
		console.log(`        ways=${ways.length} crossings=${crossings.length}`);
		allCrossings.push(...crossings);
		if (i < chunks.length - 1) await sleep(OVERPASS_PAUSE_MS);
	}

	console.log('[5/5] Deduping & writing output…');
	const deduped = dedupeCrossings(allCrossings);
	const entries = toEntries(deduped);
	const json = JSON.stringify(entries, null, 2) + '\n';
	await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
	await fs.writeFile(OUTPUT_PATH, json, 'utf-8');

	console.log(
		`\nDone. Raw crossings: ${allCrossings.length}, after dedupe (${DEDUPE_RADIUS_M}m / same roadRef): ${entries.length}`,
	);
	console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err: unknown) => {
	console.error('\nbuild-emergency-data failed:', (err as Error).message);
	process.exit(1);
});
