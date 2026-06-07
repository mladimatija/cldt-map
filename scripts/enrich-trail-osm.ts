// Enriches public/trail-osm-tags.json with OSM way tags along the CLDT.
//
// Run: `npm run enrich-osm`
// Optionally set OSM_OVERPASS_URL to a self-hosted instance.
//
// Flow:
//   1. Fetch GPX, parse trkpts, compute cumulative km.
//   2. Sample one point every ~100 m along the trail.
//   3. Group consecutive samples into chunks whose bbox fits in ~10 km x 10 km.
//   4. For each chunk: query Overpass for way[highway] within the bbox + small
//      buffer; spatially index returned ways; for each sample point find the
//      nearest way within SNAP_RADIUS_M and extract its tags.
//   5. Run-length encode the (surface, highway, sac_scale, mtb_scale) stream
//      into contiguous runs.
//   6. Validate against trail-osm-tags.schema.json.
//   7. Write public/trail-osm-tags.json and print a diff summary.

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineDistanceM as haversineM } from '../src/lib/haversine';
import { fetchOverpass } from './overpass-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SCHEMA_PATH = path.resolve(PROJECT_ROOT, 'public/trail-osm-tags.schema.json');
const OUTPUT_PATH = path.resolve(PROJECT_ROOT, 'public/trail-osm-tags.json');
const GPX_URL = process.env.NEXT_PUBLIC_GPX_URL;
const OVERPASS_URL = process.env.OSM_OVERPASS_URL?.trim() || 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'cldt-osm-enricher/1.0 (+https://cldt.hr)';

// Sampling resolution. Every 100 m yields ~22,000 samples on a 2,220 km trail.
// Lower numbers = denser sampling = more Overpass load and a larger pre-RLE
// stream. 100 m is a sweet spot: dense enough to catch short surface changes
// like a bridge or single road crossing, but cheap enough to enrich in <2 min.
const SAMPLE_STEP_M = 100;

// Maximum bbox dimension (km) per Overpass query. A larger value means fewer
// Overpass requests but more OSM data per request (and a bigger risk of
// hitting the timeout).
const CHUNK_BBOX_KM = 10;

// Maximum distance (m) from a sample point to a candidate OSM way before the
// way is considered "not the trail". 50 m allows for GPS discrepancies plus
// less-than-perfectly-tagged OSM data; tighter would lose coverage on
// poorly mapped sections, looser would attribute the wrong roads.
const SNAP_RADIUS_M = 50;

// Per-request Overpass timeout in seconds (server-side). Independent of the fetch
// timeout below.
const OVERPASS_TIMEOUT_S = 60;

// Per-request HTTP timeout (ms).
const FETCH_TIMEOUT_MS = 90_000;

// Pause between chunks to be a good citizen on the public Overpass instance.
const CHUNK_DELAY_MS = 1_500;

interface LatLng {
	lat: number;
	lng: number;
}

interface SamplePoint extends LatLng {
	km: number;
}

interface OsmWay {
	tags: Record<string, string>;
	nodes: LatLng[];
}

interface SampleTags {
	km: number;
	surface: string | null;
	highway: string | null;
	sac_scale: string | null;
	mtb_scale: string | null;
}

interface Run {
	fromKm: number;
	toKm: number;
	surface: string | null;
	highway: string | null;
	sac_scale: string | null;
	mtb_scale: string | null;
}

interface OutputFile {
	lastUpdated: string;
	totalKm: number;
	sampleStepM: number;
	runs: Run[];
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
	if (!GPX_URL) {
		fail('NEXT_PUBLIC_GPX_URL is required in env.');
	}

	console.log('-> Fetching GPX...');
	const gpx = await fetchText(GPX_URL);
	const trkpts = parseTrkpts(gpx);
	if (trkpts.length < 2) fail('GPX has fewer than 2 trkpts; aborting.');
	console.log(`  ${trkpts.length} trkpts.`);

	console.log('-> Computing cumulative distances...');
	const { cumKm, totalKm } = computeCumKm(trkpts);
	console.log(`  Total trail: ${totalKm.toFixed(1)} km.`);

	console.log(`-> Sampling every ${SAMPLE_STEP_M} m...`);
	const samples = sampleTrail(trkpts, cumKm, SAMPLE_STEP_M);
	console.log(`  ${samples.length} samples.`);

	console.log('-> Chunking samples for Overpass...');
	const chunks = chunkByBbox(samples, CHUNK_BBOX_KM);
	console.log(`  ${chunks.length} chunks of <= ${CHUNK_BBOX_KM} km bbox.`);

	const allTags: SampleTags[] = [];
	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		console.log(`-> Chunk ${i + 1}/${chunks.length} (${chunk.length} samples)...`);
		const ways = await fetchWaysInBbox(bboxOf(chunk));
		console.log(`     ${ways.length} OSM ways returned.`);
		for (const sample of chunk) {
			allTags.push(snapSampleToWays(sample, ways));
		}
		if (i < chunks.length - 1) await sleep(CHUNK_DELAY_MS);
	}

	console.log('-> Run-length encoding...');
	const runs = runLengthEncode(allTags);
	console.log(`  ${runs.length} runs.`);

	const output: OutputFile = {
		lastUpdated: isoDate(new Date()),
		totalKm: Math.round(totalKm * 10) / 10,
		sampleStepM: SAMPLE_STEP_M,
		runs,
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

	const surfaceHistogram = histogram(runs, (r) => r.surface);
	const sacHistogram = histogram(runs, (r) => r.sac_scale);
	console.log('\nSurface coverage (km):');
	for (const [k, v] of surfaceHistogram) console.log(`  ${k ?? '(untagged)'}: ${v.toFixed(1)}`);
	console.log('\nSAC scale coverage (km):');
	for (const [k, v] of sacHistogram) console.log(`  ${k ?? '(untagged)'}: ${v.toFixed(1)}`);

	console.log('\nDone. Review with `git diff public/trail-osm-tags.json` and open a PR.');
}

// ---- GPX parsing -----------------------------------------------------------

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

// ---- Cumulative km + sampling ----------------------------------------------

function computeCumKm(pts: LatLng[]): { cumKm: number[]; totalKm: number } {
	const cum: number[] = [0];
	for (let i = 1; i < pts.length; i++) {
		cum.push(cum[i - 1] + haversineM(pts[i - 1], pts[i]));
	}
	return { cumKm: cum.map((m) => m / 1000), totalKm: cum[cum.length - 1] / 1000 };
}

function sampleTrail(pts: LatLng[], cumKm: number[], stepM: number): SamplePoint[] {
	const stepKm = stepM / 1000;
	const out: SamplePoint[] = [];
	const totalKm = cumKm[cumKm.length - 1];
	let j = 0;
	for (let targetKm = 0; targetKm <= totalKm; targetKm += stepKm) {
		while (j + 1 < cumKm.length && cumKm[j + 1] < targetKm) j++;
		// Linear interpolate between j and j+1.
		const a = pts[j];
		const b = pts[Math.min(j + 1, pts.length - 1)];
		const spanKm = cumKm[Math.min(j + 1, cumKm.length - 1)] - cumKm[j];
		const t = spanKm > 0 ? (targetKm - cumKm[j]) / spanKm : 0;
		out.push({
			km: Math.round(targetKm * 1000) / 1000,
			lat: a.lat + (b.lat - a.lat) * t,
			lng: a.lng + (b.lng - a.lng) * t,
		});
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

function chunkByBbox(samples: SamplePoint[], maxKm: number): SamplePoint[][] {
	// Single-pass O(n) chunker: maintains a rolling bbox per current chunk, so
	// neither `bboxOf` (whole-array rescan) nor a spread allocation runs per
	// sample.
	const chunks: SamplePoint[][] = [];
	let current: SamplePoint[] = [];
	let bbox: Bbox | null = null;
	for (const s of samples) {
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

async function fetchWaysInBbox(b: Bbox): Promise<OsmWay[]> {
	// Pad the bbox by SNAP_RADIUS_M so samples on the edge can still snap to a
	// way whose nodes are technically just outside the chunk.
	const padDeg = SNAP_RADIUS_M / 111_000;
	const padded: Bbox = {
		minLat: b.minLat - padDeg,
		maxLat: b.maxLat + padDeg,
		minLng: b.minLng - padDeg / Math.cos((((b.maxLat + b.minLat) / 2) * Math.PI) / 180),
		maxLng: b.maxLng + padDeg / Math.cos((((b.maxLat + b.minLat) / 2) * Math.PI) / 180),
	};
	const bboxStr = `${padded.minLat},${padded.minLng},${padded.maxLat},${padded.maxLng}`;
	const query = `[out:json][timeout:${OVERPASS_TIMEOUT_S}];` + `way[highway](${bboxStr});` + `out tags geom;`;

	let res: Response;
	try {
		res = await fetchOverpass({
			url: OVERPASS_URL,
			body: `data=${encodeURIComponent(query)}`,
			userAgent: USER_AGENT,
			fetchTimeoutMs: FETCH_TIMEOUT_MS,
			onRetry: ({ message }) => console.warn(`     Overpass ${message}.`),
		});
	} catch (err) {
		console.warn(`     Overpass error: ${(err as Error).message}; treating chunk as untagged.`);
		return [];
	}
	const json = (await res.json()) as {
		elements?: Array<{
			type?: string;
			tags?: Record<string, string>;
			geometry?: Array<{ lat: number; lon: number }>;
		}>;
	};
	const elements = json.elements ?? [];
	const ways: OsmWay[] = [];
	for (const el of elements) {
		if (el.type !== 'way' || !el.tags || !el.geometry) continue;
		ways.push({
			tags: el.tags,
			nodes: el.geometry.map((g) => ({ lat: g.lat, lng: g.lon })),
		});
	}
	return ways;
}

// ---- Snap samples to nearest way -------------------------------------------

function snapSampleToWays(sample: SamplePoint, ways: OsmWay[]): SampleTags {
	let best: { way: OsmWay; distM: number } | null = null;
	for (const way of ways) {
		const d = minDistanceFromPointToWayM(sample, way);
		if (d < SNAP_RADIUS_M && (!best || d < best.distM)) {
			best = { way, distM: d };
		}
	}
	if (!best) {
		return { km: sample.km, surface: null, highway: null, sac_scale: null, mtb_scale: null };
	}
	const t = best.way.tags;
	return {
		km: sample.km,
		surface: t.surface ?? null,
		highway: t.highway ?? null,
		sac_scale: t.sac_scale ?? null,
		mtb_scale: t['mtb:scale'] ?? null,
	};
}

function minDistanceFromPointToWayM(p: LatLng, way: OsmWay): number {
	let min = Infinity;
	for (let i = 0; i < way.nodes.length - 1; i++) {
		const d = pointToSegmentDistanceM(p, way.nodes[i], way.nodes[i + 1]);
		if (d < min) min = d;
	}
	return min;
}

// Project point onto great-circle-segment then compute haversine distance to
// the projected point. Good enough at sub-100 m scales.
function pointToSegmentDistanceM(p: LatLng, a: LatLng, b: LatLng): number {
	const ax = a.lng,
		ay = a.lat;
	const bx = b.lng,
		by = b.lat;
	const px = p.lng,
		py = p.lat;
	const abx = bx - ax;
	const aby = by - ay;
	const apx = px - ax;
	const apy = py - ay;
	const ab2 = abx * abx + aby * aby;
	const t = ab2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
	const projLat = ay + t * aby;
	const projLng = ax + t * abx;
	return haversineM(p, { lat: projLat, lng: projLng });
}

// ---- Run-length encoding ---------------------------------------------------

function runLengthEncode(tags: SampleTags[]): Run[] {
	if (tags.length === 0) return [];
	const runs: Run[] = [];
	let cur: Run = {
		fromKm: tags[0].km,
		toKm: tags[0].km,
		surface: tags[0].surface,
		highway: tags[0].highway,
		sac_scale: tags[0].sac_scale,
		mtb_scale: tags[0].mtb_scale,
	};
	for (let i = 1; i < tags.length; i++) {
		const t = tags[i];
		if (
			t.surface === cur.surface &&
			t.highway === cur.highway &&
			t.sac_scale === cur.sac_scale &&
			t.mtb_scale === cur.mtb_scale
		) {
			cur.toKm = t.km;
		} else {
			runs.push(roundRun(cur));
			cur = {
				fromKm: t.km,
				toKm: t.km,
				surface: t.surface,
				highway: t.highway,
				sac_scale: t.sac_scale,
				mtb_scale: t.mtb_scale,
			};
		}
	}
	runs.push(roundRun(cur));
	return runs;
}

function roundRun(r: Run): Run {
	return {
		...r,
		fromKm: Math.round(r.fromKm * 1000) / 1000,
		toKm: Math.round(r.toKm * 1000) / 1000,
	};
}

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

function histogram(runs: Run[], key: (r: Run) => string | null): Array<[string | null, number]> {
	const counts = new Map<string | null, number>();
	for (const r of runs) {
		const k = key(r);
		const span = r.toKm - r.fromKm;
		counts.set(k, (counts.get(k) ?? 0) + span);
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
