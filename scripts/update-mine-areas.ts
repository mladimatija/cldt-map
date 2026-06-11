/**
 * Mine-suspected area (MSP) dataset builder.
 *
 * Converts the official MUP / HCR mine-suspicion polygons into the bundled
 * `public/data/mine-areas.json` the runtime layer and GPS banner consume:
 *   1. Input: either MINE_AREAS_FILE (a local GeoJSON, e.g. produced with
 *      `ogr2ogr -f GeoJSON msp.geojson MSP.shp` from the official SHP
 *      download at https://misportal.hcr.hr/), or MINE_AREAS_URL (an endpoint
 *      that returns GeoJSON directly, e.g. a WFS GetFeature with
 *      outputFormat=application/json).
 *   2. Reprojection: coordinates that are clearly not degrees are treated as
 *      HTRS96/TM (EPSG:3765, the official Croatian CRS) and inverted to
 *      WGS84. Datum shift HTRS96 -> WGS84 is sub-metre and ignored.
 *   3. Clip: polygons farther than MINE_AREAS_MAX_KM (default 10) from the
 *      trail are dropped - the map is a trail companion, not a national
 *      mine cadastre.
 *   4. Simplify: Douglas-Peucker at ~20 m so the bundle stays small.
 *   5. Trail ranges: km stretches where the trail enters a polygon
 *      ("crosses") or passes within 500 m ("near").
 *   6. Validate against public/mine-areas.schema.json and write.
 *
 * Usage:
 *   npm run update-mine-areas
 *   MINE_AREAS_FILE=/path/msp.geojson npm run update-mine-areas
 *   MINE_AREAS_URL="https://.../wfs?...&outputFormat=application/json" npm run update-mine-areas
 *
 * NOTE: Croatia was officially declared mine-free on 2026-03-01 (Ottawa
 * Convention fulfilled); misportal.hcr.hr was retired and no official MSP
 * dataset is published any more. A run without an explicit input records
 * exactly that - it writes (or keeps) the empty dataset and succeeds. The
 * full pipeline stays available behind MINE_AREAS_FILE / MINE_AREAS_URL
 * should residual-risk or UXO data ever be published again.
 */

import Ajv from 'ajv/dist/2020.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as GeoJSON from 'geojson';
import { haversineDistanceM } from '../src/lib/haversine';
import {
	distanceToMineAreaM,
	inBbox,
	MINE_NEAR_BUFFER_M,
	type MineArea,
	type MineAreasFile,
	type MineTrailRange,
} from '../src/lib/mine-areas';
import { pointInPolygon } from '../src/lib/point-in-polygon';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = path.resolve(PROJECT_ROOT, 'public/data/mine-areas.json');
const SCHEMA_PATH = path.resolve(PROJECT_ROOT, 'public/mine-areas.schema.json');

const GPX_URL = process.env.NEXT_PUBLIC_GPX_URL;
const INPUT_FILE = process.env.MINE_AREAS_FILE;
const INPUT_URL = process.env.MINE_AREAS_URL;
const MAX_KM = Number(process.env.MINE_AREAS_MAX_KM ?? 10);
/** Douglas-Peucker tolerance in degrees (~20 m at Croatian latitudes). */
const SIMPLIFY_TOLERANCE_DEG = 0.0002;
const SOURCE_LINE = 'MUP / HCR (misportal.hcr.hr)';

function fail(msg: string): never {
	console.error(`update-mine-areas failed: ${msg}`);
	process.exit(1);
}

// ---- EPSG:3765 (HTRS96/TM) <-> WGS84 ---------------------------------------
// Transverse Mercator on GRS80: k0 = 0.9999, lon0 = 16.5 deg, FE = 500000,
// FN = 0. Forward + inverse implemented with the standard Snyder series so
// the script stays dependency-free; the round trip is verified in tests to
// sub-centimetre precision, and FE at the central meridian is exact.
const TM = {
	a: 6378137,
	f: 1 / 298.257222101,
	k0: 0.9999,
	lon0: (16.5 * Math.PI) / 180,
	fe: 500_000,
	fn: 0,
};
const E2 = TM.f * (2 - TM.f);
const EP2 = E2 / (1 - E2);

function tmForward(latDeg: number, lonDeg: number): { e: number; n: number } {
	const lat = (latDeg * Math.PI) / 180;
	const lon = (lonDeg * Math.PI) / 180;
	const sin = Math.sin(lat);
	const cos = Math.cos(lat);
	const t = Math.tan(lat) ** 2;
	const c = EP2 * cos * cos;
	const aCoef = (lon - TM.lon0) * cos;
	const nu = TM.a / Math.sqrt(1 - E2 * sin * sin);
	const m =
		TM.a *
		((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * lat -
			((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * lat) +
			((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * lat) -
			((35 * E2 ** 3) / 3072) * Math.sin(6 * lat));
	const e =
		TM.fe +
		TM.k0 *
			nu *
			(aCoef + ((1 - t + c) * aCoef ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * aCoef ** 5) / 120);
	const n =
		TM.fn +
		TM.k0 *
			(m +
				nu *
					Math.tan(lat) *
					((aCoef * aCoef) / 2 +
						((5 - t + 9 * c + 4 * c * c) * aCoef ** 4) / 24 +
						((61 - 58 * t + t * t + 600 * c - 330 * EP2) * aCoef ** 6) / 720));
	return { e, n };
}

function tmInverse(e: number, n: number): { lat: number; lon: number } {
	const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
	const m = (n - TM.fn) / TM.k0;
	const mu = m / (TM.a * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
	const phi1 =
		mu +
		((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
		((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
		((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
		((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
	const sin1 = Math.sin(phi1);
	const cos1 = Math.cos(phi1);
	const t1 = Math.tan(phi1) ** 2;
	const c1 = EP2 * cos1 * cos1;
	const nu1 = TM.a / Math.sqrt(1 - E2 * sin1 * sin1);
	const rho1 = (TM.a * (1 - E2)) / (1 - E2 * sin1 * sin1) ** 1.5;
	const d = (e - TM.fe) / (nu1 * TM.k0);
	const lat =
		phi1 -
		((nu1 * Math.tan(phi1)) / rho1) *
			((d * d) / 2 -
				((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24 +
				((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720);
	const lon =
		TM.lon0 +
		(d -
			((1 + 2 * t1 + c1) * d ** 3) / 6 +
			((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) /
			cos1;
	return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

export { tmForward, tmInverse };

// ---- Geometry helpers -------------------------------------------------------

type Ring = GeoJSON.Position[];

/** Iterative Douglas-Peucker on a ring (closed: first == last). */
function simplifyRing(ring: Ring, tolerance: number): Ring {
	if (ring.length <= 5) return ring;
	const keep = new Array<boolean>(ring.length).fill(false);
	keep[0] = keep[ring.length - 1] = true;
	const stack: [number, number][] = [[0, ring.length - 1]];
	while (stack.length > 0) {
		const [lo, hi] = stack.pop() as [number, number];
		if (hi - lo < 2) continue;
		const [x1, y1] = ring[lo];
		const [x2, y2] = ring[hi];
		const dx = x2 - x1;
		const dy = y2 - y1;
		const lenSq = dx * dx + dy * dy;
		let maxDist = -1;
		let maxIdx = -1;
		for (let i = lo + 1; i < hi; i++) {
			const [px, py] = ring[i];
			let dist: number;
			if (lenSq === 0) {
				dist = Math.hypot(px - x1, py - y1);
			} else {
				const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
				dist = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
			}
			if (dist > maxDist) {
				maxDist = dist;
				maxIdx = i;
			}
		}
		if (maxDist > tolerance) {
			keep[maxIdx] = true;
			stack.push([lo, maxIdx], [maxIdx, hi]);
		}
	}
	const out = ring.filter((_, i) => keep[i]);
	// A valid ring needs 4 positions (triangle + closure); fall back to the
	// original when simplification collapses it.
	return out.length >= 4 ? out : ring;
}

function mapRings(
	geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
	mapRing: (ring: Ring) => Ring,
): GeoJSON.Polygon | GeoJSON.MultiPolygon {
	if (geometry.type === 'Polygon') {
		return { type: 'Polygon', coordinates: geometry.coordinates.map(mapRing) };
	}
	return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((poly) => poly.map(mapRing)) };
}

function geometryBbox(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number, number, number] {
	let w = Infinity;
	let s = Infinity;
	let e = -Infinity;
	let n = -Infinity;
	const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
	for (const ring of rings) {
		for (const [x, y] of ring) {
			if (x < w) w = x;
			if (x > e) e = x;
			if (y < s) s = y;
			if (y > n) n = y;
		}
	}
	return [round(w, 5), round(s, 5), round(e, 5), round(n, 5)];
}

function round(v: number, places: number): number {
	const f = 10 ** places;
	return Math.round(v * f) / f;
}

// ---- Trail handling ---------------------------------------------------------

interface TrailPoint {
	lat: number;
	lng: number;
	km: number;
}

function parseTrkpts(xml: string): { lat: number; lng: number }[] {
	const out: { lat: number; lng: number }[] = [];
	const re = /<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml)) !== null) {
		out.push({ lat: Number(m[1]), lng: Number(m[2]) });
	}
	return out;
}

function withCumKm(pts: { lat: number; lng: number }[]): TrailPoint[] {
	const out: TrailPoint[] = [];
	let km = 0;
	for (let i = 0; i < pts.length; i++) {
		if (i > 0) km += haversineDistanceM(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng) / 1000;
		out.push({ ...pts[i], km });
	}
	return out;
}

// ---- Main -------------------------------------------------------------------

async function loadInput(): Promise<GeoJSON.FeatureCollection> {
	if (INPUT_FILE) {
		console.log(`-> Reading ${INPUT_FILE}...`);
		return JSON.parse(await fs.readFile(INPUT_FILE, 'utf8')) as GeoJSON.FeatureCollection;
	}
	if (INPUT_URL) {
		console.log(`-> Fetching ${INPUT_URL}...`);
		const res = await fetch(INPUT_URL, { headers: { 'User-Agent': 'cldt-map update-mine-areas' } });
		if (!res.ok) fail(`input fetch returned HTTP ${res.status}`);
		return (await res.json()) as GeoJSON.FeatureCollection;
	}
	return fail(
		'set MINE_AREAS_FILE (local GeoJSON, e.g. from `ogr2ogr -f GeoJSON msp.geojson MSP.shp` on the official ' +
			'misportal.hcr.hr SHP download) or MINE_AREAS_URL (an endpoint returning GeoJSON).',
	);
}

/** Heuristic: EPSG:3765 eastings/northings are 6-7 digit metre values, far
 *  outside the [-180, 180] degree domain. */
function looksProjected(fc: GeoJSON.FeatureCollection): boolean {
	for (const f of fc.features) {
		const g = f.geometry;
		if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
		const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
		const first = rings[0]?.[0];
		if (first) return Math.abs(first[0]) > 180 || Math.abs(first[1]) > 90;
	}
	return false;
}

async function main(): Promise<void> {
	// No-source mode: Croatia has been officially mine-free since 2026-03-01,
	// so a plain `npm run update-mine-areas` has nothing to fetch. Record
	// exactly that - a valid empty dataset - and succeed. A previously
	// populated dataset is never erased implicitly; pass an explicit (empty)
	// input to overwrite one.
	if (!INPUT_FILE && !INPUT_URL) {
		console.log('No MINE_AREAS_FILE / MINE_AREAS_URL set.');
		console.log('Croatia has been officially mine-free since 2026-03-01; no official MSP dataset is published.');
		let prior: MineAreasFile | null = null;
		try {
			prior = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8')) as MineAreasFile;
		} catch {
			// No readable prior file.
		}
		if (prior && prior.areas.length > 0) {
			console.log(
				`Keeping the existing dataset (${prior.areas.length} areas) untouched - pass an explicit input to overwrite it.`,
			);
			return;
		}
		const empty: MineAreasFile = {
			lastUpdated: new Date().toISOString().slice(0, 10),
			source: SOURCE_LINE,
			areas: [],
			trailRanges: [],
		};
		await fs.writeFile(OUTPUT_PATH, JSON.stringify(empty, null, '\t') + '\n', 'utf8');
		console.log(`Confirmed empty dataset at ${OUTPUT_PATH} (lastUpdated ${empty.lastUpdated}).`);
		return;
	}

	if (!GPX_URL) fail('NEXT_PUBLIC_GPX_URL is required in env.');

	console.log('-> Fetching GPX...');
	const gpxRes = await fetch(GPX_URL);
	if (!gpxRes.ok) fail(`GPX fetch returned HTTP ${gpxRes.status}`);
	const trail = withCumKm(parseTrkpts(await gpxRes.text()));
	if (trail.length < 2) fail('GPX has fewer than 2 trkpts.');
	console.log(`   ${trail.length} trkpts, ${trail[trail.length - 1].km.toFixed(1)} km.`);
	// Coarse trail for the per-polygon distance scan; the full set is used for
	// the range walk below.
	const coarseTrail = trail.filter((_, i) => i % 10 === 0);

	const fc = await loadInput();
	console.log(`   ${fc.features.length} input features.`);

	const projected = looksProjected(fc);
	if (projected) console.log('-> Coordinates look projected - applying EPSG:3765 -> WGS84 inverse.');

	const areas: MineArea[] = [];
	let dropped = 0;
	let idCounter = 0;
	for (const f of fc.features) {
		const g = f.geometry;
		if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
		let geometry = g;
		if (projected) {
			geometry = mapRings(geometry, (ring) =>
				ring.map(([x, y]) => {
					const { lat, lon } = tmInverse(x, y);
					return [round(lon, 6), round(lat, 6)];
				}),
			);
		}
		geometry = mapRings(geometry, (ring) => simplifyRing(ring, SIMPLIFY_TOLERANCE_DEG));
		geometry = mapRings(geometry, (ring) => ring.map(([x, y]) => [round(x, 6), round(y, 6)]));

		// Distance to trail: scan ring vertices against the coarse trail.
		let bestM = Infinity;
		let bestKm = 0;
		const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
		for (const ring of rings) {
			for (const [lng, lat] of ring) {
				for (const tp of coarseTrail) {
					const d = haversineDistanceM(lat, lng, tp.lat, tp.lng);
					if (d < bestM) {
						bestM = d;
						bestKm = tp.km;
					}
				}
			}
		}
		if (bestM > MAX_KM * 1000) {
			dropped++;
			continue;
		}

		const props = (f.properties ?? {}) as Record<string, unknown>;
		const rawId = props.id ?? props.ID ?? props.objectid ?? props.OBJECTID ?? f.id;
		const name =
			typeof props.name === 'string' ? props.name : typeof props.NAZIV === 'string' ? props.NAZIV : undefined;
		idCounter++;
		areas.push({
			id: `msp-${rawId !== undefined && rawId !== null && rawId !== '' ? String(rawId) : idCounter}`,
			...(name && { name }),
			geometry,
			bbox: geometryBbox(geometry),
			nearestTrailKm: round(bestKm, 1),
			distanceFromTrailM: Math.round(bestM),
		});
	}
	console.log(`-> Kept ${areas.length} areas within ${MAX_KM} km of the trail (${dropped} dropped).`);

	// ---- Trail ranges ----
	console.log('-> Walking trail for crossing / proximity ranges...');
	const trailRanges: MineTrailRange[] = [];
	/** Merge tolerance: gaps shorter than this stay one range. */
	const MERGE_GAP_KM = 0.3;
	const padDeg = (MINE_NEAR_BUFFER_M / 111_320) * 1.5;
	for (const area of areas) {
		let open: { startKm: number; endKm: number; proximity: 'crosses' | 'near' } | null = null;
		const flush = (): void => {
			if (!open) return;
			trailRanges.push({
				startKm: round(open.startKm, 1),
				endKm: round(open.endKm, 1),
				proximity: open.proximity,
				areaId: area.id,
			});
			open = null;
		};
		for (const tp of trail) {
			let prox: 'crosses' | 'near' | null = null;
			if (inBbox(tp.lat, tp.lng, area.bbox, padDeg)) {
				if (pointInPolygon([tp.lng, tp.lat], area.geometry)) prox = 'crosses';
				else if (distanceToMineAreaM(tp.lat, tp.lng, area.geometry) <= MINE_NEAR_BUFFER_M) prox = 'near';
			}
			if (prox === null) {
				if (open && tp.km - open.endKm > MERGE_GAP_KM) flush();
				continue;
			}
			if (open && (open.proximity !== prox || tp.km - open.endKm > MERGE_GAP_KM)) flush();
			if (!open) open = { startKm: tp.km, endKm: tp.km, proximity: prox };
			else open.endKm = tp.km;
		}
		flush();
	}
	trailRanges.sort((a, b) => a.startKm - b.startKm);
	console.log(`   ${trailRanges.length} affected ranges.`);

	const output: MineAreasFile = {
		lastUpdated: new Date().toISOString().slice(0, 10),
		source: SOURCE_LINE,
		areas,
		trailRanges,
	};

	console.log('-> Validating schema...');
	const schema = JSON.parse(await fs.readFile(SCHEMA_PATH, 'utf8')) as Record<string, unknown>;
	const ajv = new Ajv({ strict: false, allErrors: true });
	const validate = ajv.compile(schema);
	if (!validate(output)) fail(`schema validation failed: ${JSON.stringify(validate.errors?.slice(0, 5))}`);

	// Sanity floor mirrors the POI writer: refuse to shrink a previously
	// non-empty dataset below 60% - a half-failed source download must not
	// silently erase mine warnings.
	try {
		const prior = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8')) as MineAreasFile;
		if (prior.areas.length > 0 && areas.length < prior.areas.length * 0.6) {
			fail(`fresh dataset has ${areas.length} areas vs prior ${prior.areas.length} - below the 60% floor.`);
		}
	} catch {
		// No readable prior file: first run.
	}

	// Hyphen-only policy: normalize any em/en dashes from source attributes.
	const json = (JSON.stringify(output, null, '\t') + '\n').replace(/[–—]/g, '-');
	await fs.writeFile(OUTPUT_PATH, json, 'utf8');
	const bytes = Buffer.byteLength(json);
	console.log(
		`-> Wrote ${OUTPUT_PATH} (${areas.length} areas, ${trailRanges.length} ranges, ${(bytes / 1024).toFixed(0)} KB).`,
	);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
	main().catch((err) => fail((err as Error).message));
}
