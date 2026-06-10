// Enriches public/pois.json with typed POIs along or near the CLDT.
//
// Run: `npm run enrich-pois`
// Optionally set OSM_OVERPASS_URL to a self-hosted instance.
//
// Pipeline passes (executed in this order):
//   1. OSM Overpass: per-type query (towns, settlements, peaks, viewpoints,
//      huts, shelters, food, atm) with per-type max-distance thresholds.
//   2. Croatia boundary filter: drop anything outside the country polygon.
//   3. Wikidata SPARQL: supplements towns / settlements with population, URL,
//      image, Wikipedia link.
//   4. Reachability filter: checks road/path access; tags isReachable and
//      nearestHighwayM on each POI; drops non-notable unreachable settlements.
//   5. HPS curated JSON (scripts/hps-huts.json): supplements hut POIs with
//      phone, capacity, season, curated notes.
//   6. Wikimedia Commons: fetches gallery images per POI from Wikidata P18 /
//      P373 commons category.
//   7. Wikipedia summaries: fetches truncated extracts in en + hr for the
//      popup baked-content path.
// Then: merge with the existing committed file (preserve curated `note_*`,
// `url`, `tags` fields), validate against the schema, write the result.

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineDistanceM as haversineM } from '../src/lib/haversine';
import { foldDiacritics } from '@/lib/pois';
import type { Poi, PoiImage, PoisFile } from '../src/lib/poi-types';
import { parseWikipediaRef, SUMMARY_HOST_TEMPLATE as WIKIPEDIA_SUMMARY_HOST_TEMPLATE } from '../src/lib/wikipedia';
import { applyReachabilityFilter, formatStats } from './poi-reachability';
import { fetchOverpass } from './overpass-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SCHEMA_PATH = path.resolve(PROJECT_ROOT, 'public/pois.schema.json');
const OUTPUT_PATH = path.resolve(PROJECT_ROOT, 'public/pois.json');
const HPS_HUTS_PATH = path.resolve(PROJECT_ROOT, 'scripts/hps-huts.json');
const CROATIA_GEOJSON_PATH = path.resolve(PROJECT_ROOT, 'public/data/geoJsonHr.json');
const GPX_URL = process.env.NEXT_PUBLIC_GPX_URL;
const OVERPASS_URL = process.env.OSM_OVERPASS_URL?.trim() || 'https://overpass-api.de/api/interpreter';
/** Community mirrors tried in order when the primary exhausts its retries.
 *  Override with a comma-separated OSM_OVERPASS_FALLBACK_URLS; set it empty
 *  to disable failover. */
const OVERPASS_FALLBACK_URLS = (
	process.env.OSM_OVERPASS_FALLBACK_URLS ?? 'https://overpass.kumi.systems/api/interpreter'
)
	.split(',')
	.map((s) => s.trim())
	.filter((s) => s.length > 0 && safeUrl(s));
const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'cldt-poi-enricher/2.0 (+https://cldt.hr)';

/** Buffer (km) around the trail bbox used as the Overpass query area (the
 *  corridor query's fallback path only). */
const BBOX_BUFFER_KM = 30;

/** Trail downsampling step for the corridor query polyline. With radius
 *  slack >= step/2, sampling cannot open gaps in the corridor: any POI
 *  within a type's maxDistanceKm of the full trail is within
 *  maxDistanceKm + step/2 of some sampled point. */
const CORRIDOR_SAMPLE_STEP_KM = 2;
/** Added to each type's maxDistanceKm for the around-radius (covers the
 *  sampling gap above plus snap error). */
const CORRIDOR_RADIUS_SLACK_KM = 2;

/** On-disk cache for successful per-type Overpass results, so a rerun after
 *  a partial failure only refetches the types that actually failed. Keyed on
 *  the full query text, so any change to selectors, radius, or trail
 *  invalidates naturally. Disable with ENRICH_POIS_NO_CACHE=1. */
const OVERPASS_CACHE_DIR = path.resolve(PROJECT_ROOT, '.cache/enrich-pois');
const OVERPASS_CACHE_TTL_MS = Number(process.env.ENRICH_POIS_CACHE_TTL_HOURS ?? 24) * 3_600_000;
const OVERPASS_CACHE_DISABLED = process.env.ENRICH_POIS_NO_CACHE === '1';

const OVERPASS_TIMEOUT_S = 180;
// Client timeout must exceed the server-side [timeout:] so we read Overpass's
// own timeout response (a retryable 504-class signal) instead of aborting
// first and losing the distinction from a dead connection.
const FETCH_TIMEOUT_MS = 200_000;
const WIKIDATA_TIMEOUT_MS = 120_000;
const PAUSE_BETWEEN_PASSES_MS = 2_000;

/**
 * Per-POI-type Overpass configuration. Each entry maps to one POI `type`
 * string the renderer knows, an array of `(tag-key, tag-value)` selector
 * pairs that get unioned into a single `node[...]; way[...]` block in the
 * Overpass query, and a maximum off-trail distance beyond which the POI is
 * filtered out. Adding a new type only needs an entry here + a palette
 * color in PoiMarkers.tsx + a settings checkbox + an i18n label.
 */
interface TypeConfig {
	type: string;
	overpassSelectors: { key: string; values: string[] }[];
	maxDistanceKm: number;
}

// maxDistanceKm values are the HARD caps shared with the reachability filter's
// TIER_RULES in scripts/poi-reachability.ts. Keep the two in sync - Pass 1
// drops anything past the cap, and the reachability pass re-enforces the same
// threshold while also applying notability and road-access requirements.
const TYPE_CONFIGS: TypeConfig[] = [
	{ type: 'town', overpassSelectors: [{ key: 'place', values: ['city', 'town'] }], maxDistanceKm: 3 },
	{ type: 'settlement', overpassSelectors: [{ key: 'place', values: ['village', 'hamlet'] }], maxDistanceKm: 1.5 },
	{ type: 'peak', overpassSelectors: [{ key: 'natural', values: ['peak'] }], maxDistanceKm: 10 },
	{ type: 'viewpoint', overpassSelectors: [{ key: 'tourism', values: ['viewpoint'] }], maxDistanceKm: 6 },
	{ type: 'hut', overpassSelectors: [{ key: 'tourism', values: ['alpine_hut', 'wilderness_hut'] }], maxDistanceKm: 15 },
	{ type: 'shelter', overpassSelectors: [{ key: 'amenity', values: ['shelter'] }], maxDistanceKm: 15 },
	{
		type: 'restaurant',
		overpassSelectors: [{ key: 'amenity', values: ['restaurant', 'fast_food'] }],
		maxDistanceKm: 2,
	},
	{
		type: 'cafe',
		overpassSelectors: [{ key: 'amenity', values: ['cafe', 'pub'] }],
		maxDistanceKm: 2,
	},
	{ type: 'atm', overpassSelectors: [{ key: 'amenity', values: ['atm', 'bank'] }], maxDistanceKm: 2 },
	{
		// Drinking water is the most safety-critical resupply type on a 2200 km
		// trail; the 1 km cap keeps only sources a hiker would realistically
		// detour to. natural=spring is included because much of the karst
		// corridor relies on springs rather than mapped taps.
		type: 'water',
		overpassSelectors: [
			{ key: 'amenity', values: ['drinking_water'] },
			{ key: 'natural', values: ['spring'] },
		],
		maxDistanceKm: 1,
	},
];

interface LatLng {
	lat: number;
	lng: number;
}

// Poi, PoiImage, PoisFile re-used from the canonical src/lib/poi-types, so
// schema drift between the dataset writer and the runtime loader is
// structurally impossible.

interface OverpassElement {
	type: 'node' | 'way' | 'relation';
	id: number;
	lat?: number;
	lon?: number;
	center?: { lat: number; lon: number };
	tags?: Record<string, string>;
}

interface HpsHutEntry {
	name: string;
	lat: number;
	lng: number;
	phone?: string;
	capacity?: number;
	season?: string;
	url?: string;
	note_en?: string;
	note_hr?: string;
}

interface HpsFile {
	huts: HpsHutEntry[];
}

interface Bbox {
	minLat: number;
	maxLat: number;
	minLng: number;
	maxLng: number;
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
	if (!GPX_URL) fail('NEXT_PUBLIC_GPX_URL is required in env.');
	if (!safeUrl(GPX_URL)) fail('NEXT_PUBLIC_GPX_URL must be an http(s) URL.');
	if (!safeUrl(OVERPASS_URL)) fail('OSM_OVERPASS_URL must be an http(s) URL.');

	console.log('-> Fetching GPX...');
	const trkpts = parseTrkpts(await fetchText(GPX_URL));
	if (trkpts.length < 2) fail('GPX has fewer than 2 trkpts; aborting.');
	console.log(`  ${trkpts.length} trkpts.`);

	const cumKm = computeCumKm(trkpts);
	const totalKm = cumKm[cumKm.length - 1];
	console.log(`  Total trail: ${totalKm.toFixed(1)} km.`);

	const bbox = bboxOf(trkpts);
	const paddedBbox = padBbox(bbox, BBOX_BUFFER_KM);
	const corridorPoly = downsampleTrail(trkpts, cumKm, CORRIDOR_SAMPLE_STEP_KM);
	console.log(`  Corridor polyline: ${corridorPoly.length} points (${CORRIDOR_SAMPLE_STEP_KM} km step).`);

	// ---- Pass 1: OSM per-type ----
	console.log('\n=== Pass 1: OSM Overpass ===');
	const byId = new Map<string, Poi>();
	/** POI types whose Pass 1 Overpass query failed (HTTP error or aborted).
	 *  The merge step carries forward every prior entry of these types, so a
	 *  transient upstream failure never silently nukes the dataset. */
	const failedTypes = new Set<string>();
	for (let cfgIdx = 0; cfgIdx < TYPE_CONFIGS.length; cfgIdx++) {
		const cfg = TYPE_CONFIGS[cfgIdx];
		console.log(`-> Querying type=${cfg.type} (selectors: ${describeSelectors(cfg.overpassSelectors)})...`);
		const { elements, failed } = await fetchOsmElements(cfg, corridorPoly, paddedBbox);
		if (failed) failedTypes.add(cfg.type);
		console.log(`     ${elements.length} candidates.`);
		let kept = 0;
		for (const el of elements) {
			const point = elementToLatLng(el);
			if (!point) continue;
			const name_en = pickName(el.tags ?? {}, 'en');
			const name_hr = pickName(el.tags ?? {}, 'hr');
			if (!name_en && !name_hr) continue;
			const { km, distKm } = snapToTrail(point, trkpts, cumKm);
			if (distKm > cfg.maxDistanceKm) continue;
			const population = parseInteger(el.tags?.population);
			const id = slug(`${cfg.type}-${name_en || name_hr}-${el.id}`);
			if (byId.has(id)) continue;
			const elevationM = parseInteger(el.tags?.ele);
			// OSM website tags are user-edited free text - sanitise, so a
			// malformed value (no scheme, embedded whitespace, ...) doesn't
			// blow up the Ajv `format: "uri"` check later.
			const url = safeUrl(el.tags?.website) ?? safeUrl(el.tags?.['contact:website']);
			const image = safeUrl(el.tags?.image);
			byId.set(id, {
				id,
				type: cfg.type,
				name_en: name_en || name_hr,
				name_hr: name_hr || name_en,
				lat: round(point.lat, 5),
				lng: round(point.lng, 5),
				trailKm: round(km, 1),
				distanceFromTrailKm: round(distKm, 2),
				...(population !== null && { population }),
				...(elevationM !== null && { elevationM }),
				...(el.tags?.phone && { phone: el.tags.phone }),
				...(url && { url }),
				...(image && { image }),
				// Default source for any pass-1 entry. Upgraded to `wikidata` or
				// `hps` if later passes add data; `curated` is preserved by the
				// merge step from any prior committed row.
				source: 'osm',
			});
			kept++;
		}
		console.log(`     kept ${kept} after distance filter.`);
		if (cfgIdx < TYPE_CONFIGS.length - 1) await sleep(PAUSE_BETWEEN_PASSES_MS);
	}
	console.log(`  Pass 1 total: ${byId.size} POIs (pre-boundary).`);

	// ---- Boundary filter: drop POIs outside Croatia ----
	// The Overpass bbox is the trail bbox + 30 km buffer, which inevitably
	// bleeds into Slovenia, Hungary, Bosnia, and Italy. The per-type max-distance
	// filter only checks distance from the trail, not country - a
	// Slovenian village 8 km from the Istrian trail still passes that gate.
	// A point-in-polygon check against the bundled Croatia boundary nukes
	// the cross-border leaks.
	const polys = await loadCroatiaBoundary();
	if (polys.length > 0) {
		const beforeBoundary = byId.size;
		let dropped = 0;
		for (const [id, poi] of [...byId.entries()]) {
			if (!pointInCroatia(poi.lat, poi.lng, polys)) {
				byId.delete(id);
				dropped++;
			}
		}
		console.log(
			`  Boundary filter: dropped ${dropped} of ${beforeBoundary} POIs outside Croatia (${byId.size} remain).`,
		);
	}

	// ---- Pass 2: Wikidata SPARQL supplement ----
	// One bbox query per POI category (settlements / peaks / huts / viewpoints)
	// because each maps to a different Wikidata entity-class umbrella. Results
	// land in a per-type map; the matcher then runs per POI against the map
	// that fits its type. Pass 4 reads `wdByPoiId` regardless of category, so
	// every matched POI gets a chance at a Commons gallery.
	console.log('\n=== Pass 2: Wikidata SPARQL (multi-type) ===');
	const wdByPoiId = new Map<string, WikidataPlace>();
	const wikidataByType = new Map<string, Map<string, WikidataPlace>>();
	// Dedup queries that share the same IRI list (town + settlement both use
	// the human-settlement umbrella) so we don't double up against the
	// Wikidata endpoint. Cache keyed on the joined IRI string.
	const cachedByIrisKey = new Map<string, Map<string, WikidataPlace>>();
	for (const [poiType, filter] of Object.entries(WIKIDATA_TYPE_FILTERS)) {
		// Cache key carries the membership mode, so a future config that
		// shared the same IRI list across transitive + direct queries
		// would still issue both.
		const key = `${filter.transitive ? 'T' : 'D'}|${filter.iris.slice().sort().join(',')}`;
		let map = cachedByIrisKey.get(key);
		if (!map) {
			const mode = filter.transitive ? 'subclass walk' : 'direct';
			console.log(`-> Querying ${poiType} (${mode}, filters: ${filter.iris.join(',')})...`);
			map = await fetchWikidataPlacesInBbox(paddedBbox, filter);
			console.log(`     returned ${map.size} entries.`);
			cachedByIrisKey.set(key, map);
			await sleep(PAUSE_BETWEEN_PASSES_MS);
		} else {
			console.log(`-> Reusing ${poiType} query result (${map.size} entries).`);
		}
		wikidataByType.set(poiType, map);
	}

	// Tally per-type hits, so the log tells us where the matcher is earning
	// vs. wasted.
	const hitsByType = new Map<string, { hits: number; total: number }>();
	for (const poi of byId.values()) {
		const map = wikidataByType.get(poi.type);
		if (!map) continue;
		const tally = hitsByType.get(poi.type) ?? { hits: 0, total: 0 };
		tally.total++;
		const wd = matchWikidataByName(map, poi);
		if (!wd) {
			hitsByType.set(poi.type, tally);
			continue;
		}
		tally.hits++;
		hitsByType.set(poi.type, tally);
		wdByPoiId.set(poi.id, wd);
		if (wd.population && !poi.population) poi.population = wd.population;
		if (!poi.url) {
			const u = safeUrl(wd.url);
			if (u) poi.url = u;
		}
		if (!poi.image) {
			const i = safeUrl(wd.image);
			if (i) poi.image = i;
		}
		if (!poi.wikipedia) {
			const w = safeUrl(wd.wikipedia);
			if (w) poi.wikipedia = w;
		}
		// Upgrade source: Wikidata is generally higher-fidelity for civic data
		// than raw OSM tags. Only upgrade if not already a higher tier.
		if (poi.source === 'osm') poi.source = 'wikidata';
	}
	for (const [poiType, { hits, total }] of hitsByType) {
		console.log(`  Wikidata matched ${hits} / ${total} ${poiType}.`);
	}

	// ---- Pass 6: Reachability filter (highway graph + tier rules) ----
	// Runs here (after Wikidata enrichment, before the expensive Commons +
	// Wikipedia passes) so per-type drop tallies reflect notability rescues
	// from Pass 2, and so Pass 4 / Pass 5 don't waste API calls on POIs we're
	// about to drop. Overpass failure is non-fatal: the pass logs and skips,
	// leaving the Pass 1 distance-filtered set intact.
	console.log('\n=== Pass 6: Reachability filter ===');
	try {
		const beforeReach = byId.size;
		const result = await applyReachabilityFilter([...byId.values()], trkpts, paddedBbox, OVERPASS_URL, USER_AGENT);
		byId.clear();
		for (const p of result.kept) byId.set(p.id, p);
		const dropped = beforeReach - result.kept.length;
		console.log(`  Reachability filter dropped ${dropped} / ${beforeReach} POIs (${result.kept.length} remain).`);
		console.log('  Per-type breakdown:');
		console.log(formatStats(result.stats));
	} catch (err) {
		console.warn(`  Reachability filter failed (${(err as Error).message}) - skipping.`);
		console.warn(
			'  POIs that passed Pass 1 distance gate are kept as-is. Re-run when Overpass corridor query is healthy.',
		);
	}

	// ---- Pass 3: HPS curated huts ----
	console.log('\n=== Pass 3: HPS curated huts ===');
	const hps = await readJsonOptional<HpsFile>(HPS_HUTS_PATH);
	if (hps?.huts?.length) {
		console.log(`  Loaded ${hps.huts.length} curated HPS entries.`);
		let hpsHits = 0;
		for (const poi of byId.values()) {
			if (poi.type !== 'hut') continue;
			const match = matchHpsByNameAndDistance(hps.huts, poi);
			if (!match) continue;
			hpsHits++;
			if (match.phone) poi.phone = match.phone;
			if (typeof match.capacity === 'number') poi.capacity = match.capacity;
			if (match.season) poi.season = match.season;
			if (!poi.url) {
				const u = safeUrl(match.url);
				if (u) poi.url = u;
			}
			if (match.note_en && !poi.note_en) poi.note_en = match.note_en;
			if (match.note_hr && !poi.note_hr) poi.note_hr = match.note_hr;
			// HPS is the strongest non-curated source for huts (manually
			// maintained by the federation). Always upgrades osm / wikidata.
			if (poi.source !== 'curated') poi.source = 'hps';
		}
		console.log(`  HPS matched ${hpsHits} huts.`);
	} else {
		console.log('  (no scripts/hps-huts.json found - skipping HPS pass)');
	}

	// ---- Pass 4: Wikimedia Commons photo galleries ----
	console.log('\n=== Pass 4: Wikimedia Commons ===');
	await populatePhotoGalleries(byId, wdByPoiId);

	// ---- Pass 5: Wikipedia summaries baked into the dataset ----
	console.log('\n=== Pass 5: Wikipedia summaries ===');
	await populateWikipediaSummaries(byId);

	// ---- Merge with existing curated fields ----
	console.log('\n=== Merging with prior curated fields ===');
	const prior = await readJsonOptional<PoisFile>(OUTPUT_PATH);
	const merged = mergePreservingCurated([...byId.values()], prior?.pois ?? [], failedTypes, polys);
	merged.sort((a, b) => a.trailKm - b.trailKm);

	// Normalize em/en-dashes in all string fields before writing so the
	// committed JSON never contains U+2013 or U+2014 regardless of upstream
	// source (OSM, Wikipedia, Commons).
	const normalizedMerged = merged.map(normalizePoiDashes);

	const output: PoisFile = {
		lastUpdated: isoDate(new Date()),
		pois: normalizedMerged,
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

	// Sanity guard: refuse to clobber a healthy dataset with a much smaller
	// one. Upstream services (Overpass, Wikidata, Commons) sporadically time
	// out; without this guard a bad day at overpass-api.de silently shrinks
	// the committed dataset by thousands of rows. Threshold is 60% of the
	// prior row count - tight enough to catch real degradation, loose enough
	// to allow legitimate shrinkage if the user changes filter thresholds.
	const priorRowCount = prior?.pois?.length ?? 0;
	const SANITY_THRESHOLD = 0.6;
	if (priorRowCount > 0 && merged.length < priorRowCount * SANITY_THRESHOLD) {
		console.error(
			`\nABORTING WRITE: fresh dataset has ${merged.length} rows vs prior ${priorRowCount} ` +
				`(${((merged.length / priorRowCount) * 100).toFixed(0)}% - below ${(SANITY_THRESHOLD * 100).toFixed(0)}% floor).`,
		);
		console.error('This usually means an upstream API (Overpass, Wikidata) had transient failures.');
		console.error('The existing public/pois.json is unchanged. Re-run when upstream services are healthy.');
		process.exit(2);
	}

	console.log('-> Writing output...');
	await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, '\t') + '\n', 'utf8');

	const typeHist = histogram(merged, (p) => p.type);
	console.log('\nType breakdown:');
	for (const [k, v] of typeHist) console.log(`  ${k}: ${v}`);
	const onTrail = merged.filter((p) => p.distanceFromTrailKm < 0.5).length;
	console.log(`\nOn-trail (< 500 m): ${onTrail} / ${merged.length}`);
	console.log('\nDone. Review with `git diff public/pois.json` and open a PR.');
}

// ---- GPX / geometry --------------------------------------------------------

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

function computeCumKm(pts: LatLng[]): number[] {
	const cum: number[] = [0];
	for (let i = 1; i < pts.length; i++) {
		cum.push(cum[i - 1] + haversineM(pts[i - 1], pts[i]) / 1000);
	}
	return cum;
}

function bboxOf(pts: LatLng[]): Bbox {
	let minLat = Infinity,
		maxLat = -Infinity,
		minLng = Infinity,
		maxLng = -Infinity;
	for (const p of pts) {
		if (p.lat < minLat) minLat = p.lat;
		if (p.lat > maxLat) maxLat = p.lat;
		if (p.lng < minLng) minLng = p.lng;
		if (p.lng > maxLng) maxLng = p.lng;
	}
	return { minLat, maxLat, minLng, maxLng };
}

function padBbox(b: Bbox, paddingKm: number): Bbox {
	const padDeg = paddingKm / 111;
	const cosLat = Math.cos((((b.maxLat + b.minLat) / 2) * Math.PI) / 180);
	return {
		minLat: b.minLat - padDeg,
		maxLat: b.maxLat + padDeg,
		minLng: b.minLng - padDeg / cosLat,
		maxLng: b.maxLng + padDeg / cosLat,
	};
}

// ---- Croatia boundary filter ----------------------------------------------

/** Loaded once from `public/data/geoJsonHr.json` at startup. Multi-polygon
 *  coordinates in `[lng, lat]` order per GeoJSON convention. */
type Ring = [number, number][];
let croatiaPolygons: Ring[][] | null = null;

async function loadCroatiaBoundary(): Promise<Ring[][]> {
	if (croatiaPolygons) return croatiaPolygons;
	try {
		const raw = JSON.parse(await fs.readFile(CROATIA_GEOJSON_PATH, 'utf8')) as {
			geojson?: { type?: string; coordinates?: number[][][][] | number[][][] };
		};
		const g = raw.geojson;
		if (!g) throw new Error('geojson missing');
		if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
			croatiaPolygons = g.coordinates as Ring[][];
		} else if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
			croatiaPolygons = [g.coordinates as Ring[]];
		} else {
			throw new Error(`unexpected geometry type: ${g.type}`);
		}
		return croatiaPolygons;
	} catch (err) {
		console.warn(`  Could not load Croatia boundary: ${(err as Error).message}. Filter disabled.`);
		croatiaPolygons = [];
		return croatiaPolygons;
	}
}

/** Ray-cast point-in-polygon. Iterates outer + hole rings; a point is "in"
 *  when it's inside an outer ring AND not inside any of that polygon's
 *  holes. GeoJSON convention: ring[0] is the outer ring, ring[1..] are
 *  holes. */
function pointInRing(lat: number, lng: number, ring: Ring): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const xi = ring[i][0],
			yi = ring[i][1];
		const xj = ring[j][0],
			yj = ring[j][1];
		const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

function pointInCroatia(lat: number, lng: number, polys: Ring[][]): boolean {
	if (polys.length === 0) return true; // boundary load failed - permissive
	for (const poly of polys) {
		if (poly.length === 0) continue;
		if (!pointInRing(lat, lng, poly[0])) continue;
		let inHole = false;
		for (let h = 1; h < poly.length; h++) {
			if (pointInRing(lat, lng, poly[h])) {
				inHole = true;
				break;
			}
		}
		if (!inHole) return true;
	}
	return false;
}

function snapToTrail(p: LatLng, trkpts: LatLng[], cumKm: number[]): { km: number; distKm: number } {
	let bestIdx = 0;
	let bestD = Infinity;
	for (let i = 0; i < trkpts.length; i++) {
		const d = haversineM(p, trkpts[i]);
		if (d < bestD) {
			bestD = d;
			bestIdx = i;
		}
	}
	return { km: cumKm[bestIdx], distKm: bestD / 1000 };
}

function elementToLatLng(el: OverpassElement): LatLng | null {
	if (typeof el.lat === 'number' && typeof el.lon === 'number') return { lat: el.lat, lng: el.lon };
	if (el.center) return { lat: el.center.lat, lng: el.center.lon };
	return null;
}

// ---- Overpass --------------------------------------------------------------

function describeSelectors(sel: { key: string; values: string[] }[]): string {
	return sel.map((s) => `${s.key}=${s.values.join('|')}`).join(', ');
}

interface OsmFetchResult {
	elements: OverpassElement[];
	/** True when Overpass returned a non-OK HTTP or the request threw. The
	 *  caller uses this to distinguish a transient failure (where prior data
	 *  should be carried forward in the merge step) from a genuinely empty
	 *  result. */
	failed: boolean;
}

/**
 * Downsamples the trail to roughly one point per `stepKm` of trail distance
 * (always keeping the final point), producing the polyline for the Overpass
 * `around:` corridor clause. ~2,244 km at a 2 km step is ~1,120 points -
 * small enough to embed in the query, dense enough that the radius slack
 * covers the gaps.
 */
function downsampleTrail(pts: LatLng[], cumKm: number[], stepKm: number): LatLng[] {
	const out: LatLng[] = [];
	let nextAtKm = 0;
	for (let i = 0; i < pts.length; i++) {
		if (cumKm[i] >= nextAtKm) {
			out.push(pts[i]);
			nextAtKm = cumKm[i] + stepKm;
		}
	}
	const last = pts[pts.length - 1];
	if (out[out.length - 1] !== last) out.push(last);
	return out;
}

function buildOverpassQuery(selectors: { key: string; values: string[] }[], areaClause: string): string {
	// Build per-selector clauses for both `node` and `way` (so e.g., shelters
	// modelled as buildings are picked up via their centroid).
	const clauses: string[] = [];
	for (const s of selectors) {
		for (const v of s.values) {
			clauses.push(`node["${s.key}"="${v}"](${areaClause});`);
			clauses.push(`way["${s.key}"="${v}"](${areaClause});`);
		}
	}
	return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];(${clauses.join('')});out center tags;`;
}

/** Cache path for one query; the hash covers selectors, radius, and the
 *  corridor polyline, so any input change misses the cache naturally. */
function overpassCachePath(type: string, query: string): string {
	const hash = createHash('sha1').update(query).digest('hex').slice(0, 12);
	return path.join(OVERPASS_CACHE_DIR, `${type}-${hash}.json`);
}

async function readOverpassCache(file: string): Promise<OverpassElement[] | null> {
	if (OVERPASS_CACHE_DISABLED) return null;
	try {
		const raw = JSON.parse(await fs.readFile(file, 'utf8')) as { fetchedAt?: number; elements?: OverpassElement[] };
		if (typeof raw.fetchedAt !== 'number' || !Array.isArray(raw.elements)) return null;
		if (Date.now() - raw.fetchedAt > OVERPASS_CACHE_TTL_MS) return null;
		return raw.elements;
	} catch {
		return null;
	}
}

async function writeOverpassCache(file: string, elements: OverpassElement[]): Promise<void> {
	if (OVERPASS_CACHE_DISABLED) return;
	try {
		await fs.mkdir(OVERPASS_CACHE_DIR, { recursive: true });
		await fs.writeFile(file, JSON.stringify({ fetchedAt: Date.now(), elements }));
	} catch (err) {
		console.warn(`     cache write failed (${(err as Error).message}); continuing without cache.`);
	}
}

async function runOverpassQuery(query: string): Promise<OverpassElement[]> {
	const res = await fetchOverpass({
		url: OVERPASS_URL,
		fallbackUrls: OVERPASS_FALLBACK_URLS,
		body: `data=${encodeURIComponent(query)}`,
		userAgent: USER_AGENT,
		fetchTimeoutMs: FETCH_TIMEOUT_MS,
		onRetry: ({ message }) => console.warn(`     Overpass ${message}.`),
	});
	const json = (await res.json()) as { elements?: OverpassElement[] };
	return json.elements ?? [];
}

/**
 * Fetches the OSM candidates for one POI type.
 *
 * Strategy, in order:
 *   1. Fresh on-disk cache hit for the exact query - free, makes reruns
 *      after a partial failure only refetch the types that failed.
 *   2. Corridor query: `around:` the downsampled trail polyline with radius
 *      maxDistanceKm + slack. Overpass evaluates this against its spatial
 *      index over a ~2-17 km ribbon instead of scanning a country-sized
 *      bbox, which is what made the old per-type queries blow the server
 *      [timeout:] and 504 under load. Results are identical because the
 *      precise snap-to-trail distance filter still runs afterwards.
 *   3. Legacy bbox query as a fallback when the corridor query fails
 *      terminally (e.g., a mirror that rejects long request bodies).
 */
async function fetchOsmElements(cfg: TypeConfig, corridorPoly: LatLng[], bbox: Bbox): Promise<OsmFetchResult> {
	const radiusM = Math.round((cfg.maxDistanceKm + CORRIDOR_RADIUS_SLACK_KM) * 1000);
	const polyStr = corridorPoly.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(',');
	const corridorQuery = buildOverpassQuery(cfg.overpassSelectors, `around:${radiusM},${polyStr}`);

	const cacheFile = overpassCachePath(cfg.type, corridorQuery);
	const cached = await readOverpassCache(cacheFile);
	if (cached) {
		console.log(
			`     cache hit (${cached.length} elements; delete ${path.relative(PROJECT_ROOT, cacheFile)} to refetch).`,
		);
		return { elements: cached, failed: false };
	}

	try {
		const elements = await runOverpassQuery(corridorQuery);
		await writeOverpassCache(cacheFile, elements);
		return { elements, failed: false };
	} catch (err) {
		console.warn(`     corridor query failed (${(err as Error).message}); falling back to bbox query.`);
	}

	const bboxClause = `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`;
	try {
		const elements = await runOverpassQuery(buildOverpassQuery(cfg.overpassSelectors, bboxClause));
		await writeOverpassCache(cacheFile, elements);
		return { elements, failed: false };
	} catch (err) {
		console.warn(`     Overpass error: ${(err as Error).message}; skipping this type.`);
		return { elements: [], failed: true };
	}
}

// ---- Wikidata SPARQL -------------------------------------------------------

interface WikidataPlace {
	qid: string;
	label_en?: string;
	label_hr?: string;
	lat: number;
	lng: number;
	population?: number;
	url?: string;
	image?: string;
	wikipedia?: string;
	commonsCategory?: string;
}

// PoiImage imported from src/lib/poi-types (see top of file).

/** Wikidata entity classes we query per POI category.
 *
 *  `iris` is the list of QIDs to match against.
 *  `transitive: true` (default) walks `wdt:P31/wdt:P279*` so all subclasses
 *      are caught - works well for narrow classes like Q8502 (mountain).
 *  `transitive: false` uses direct `wdt:P31` only - mandatory for very broad
 *      classes like Q486972 (human settlement) where the transitive walk
 *      hits tens of thousands of global subclasses and Wikidata 504s.
 *
 *  Adding a new POI category here is the only step needed to extend Pass 2. */
interface WikidataTypeFilter {
	iris: string[];
	transitive: boolean;
}

const WIKIDATA_TYPE_FILTERS: Record<string, WikidataTypeFilter> = {
	// Towns + settlements: list the common civic-entity classes
	// explicitly and skip the transitive walk. Covers cities, towns,
	// villages, hamlets, the umbrella class itself, plus the Croatian-specific
	// "naselje" and "selo" classes that catch a lot of local POIs.
	town: {
		iris: ['wd:Q515', 'wd:Q3957', 'wd:Q532', 'wd:Q5084', 'wd:Q486972', 'wd:Q1366921', 'wd:Q14757767'],
		transitive: false,
	},
	settlement: {
		iris: ['wd:Q515', 'wd:Q3957', 'wd:Q532', 'wd:Q5084', 'wd:Q486972', 'wd:Q1366921', 'wd:Q14757767'],
		transitive: false,
	},
	// Peaks: mountain (Q8502) covers most named summits; summit (Q207326) is
	// a narrower geomorphology term that occasionally gets used instead.
	peak: { iris: ['wd:Q8502', 'wd:Q207326'], transitive: true },
	// Huts: mountain hut (Q1149275) for HPS-style refuges + alpine refuges.
	hut: { iris: ['wd:Q1149275', 'wd:Q3024240'], transitive: true },
	// Viewpoints: observation tower (Q1404011) + tourist attraction (Q570116).
	// We cast wider here because viewpoints are inconsistently typed.
	viewpoint: { iris: ['wd:Q1404011', 'wd:Q570116'], transitive: true },
};

async function fetchWikidataPlacesInBbox(bbox: Bbox, filter: WikidataTypeFilter): Promise<Map<string, WikidataPlace>> {
	if (filter.iris.length === 0) return new Map();
	// Build a `VALUES ?type { ... }` clause. The membership clause picks
	// a transitive subclass walk vs. direct instance-of based on the filter
	// config - transitive is more thorough but explodes for broad classes
	// (Q486972 has tens of thousands of subclasses globally and the
	// endpoint 504s).
	const valuesClause = `VALUES ?type { ${filter.iris.join(' ')} }`;
	const membershipClause = filter.transitive ? '?item wdt:P31/wdt:P279* ?type .' : '?item wdt:P31 ?type .';
	const query = `
	SELECT ?item ?itemLabel ?labelHr ?coord ?population ?url ?image ?wikipedia ?commonsCategory WHERE {
		SERVICE wikibase:box {
			?item wdt:P625 ?coord .
			bd:serviceParam wikibase:cornerWest "Point(${bbox.minLng} ${bbox.minLat})"^^geo:wktLiteral .
			bd:serviceParam wikibase:cornerEast "Point(${bbox.maxLng} ${bbox.maxLat})"^^geo:wktLiteral .
		}
		${valuesClause}
		${membershipClause}
		OPTIONAL { ?item wdt:P1082 ?population . }
		OPTIONAL { ?item wdt:P856 ?url . }
		OPTIONAL { ?item wdt:P18 ?image . }
		OPTIONAL { ?item wdt:P373 ?commonsCategory . }
		OPTIONAL { ?item rdfs:label ?labelHr . FILTER(LANG(?labelHr) = "hr") }
		OPTIONAL {
			?wikipedia schema:about ?item ;
				schema:isPartOf <https://hr.wikipedia.org/> .
		}
		SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
	}
	LIMIT 5000`;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), WIKIDATA_TIMEOUT_MS);
	try {
		const res = await fetch(`${WIKIDATA_SPARQL_URL}?format=json&query=${encodeURIComponent(query)}`, {
			method: 'GET',
			headers: { accept: 'application/sparql-results+json', 'user-agent': USER_AGENT },
			signal: controller.signal,
		});
		if (!res.ok) {
			console.warn(`  Wikidata returned HTTP ${res.status} for [${filter.iris.join(',')}]; skipping.`);
			return new Map();
		}
		const json = (await res.json()) as {
			results?: {
				bindings?: Array<Record<string, { value?: string; type?: string }>>;
			};
		};
		const out = new Map<string, WikidataPlace>();
		for (const b of json.results?.bindings ?? []) {
			const qid = b.item?.value?.split('/').pop();
			const coord = b.coord?.value;
			if (!qid || !coord) continue;
			const m = /Point\(([-\d.]+)\s+([-\d.]+)\)/.exec(coord);
			if (!m) continue;
			const lng = parseFloat(m[1]);
			const lat = parseFloat(m[2]);
			out.set(qid, {
				qid,
				label_en: b.itemLabel?.value,
				label_hr: b.labelHr?.value,
				lat,
				lng,
				population: b.population?.value ? (parseInteger(b.population.value) ?? undefined) : undefined,
				url: b.url?.value,
				image: b.image?.value,
				wikipedia: b.wikipedia?.value,
				commonsCategory: b.commonsCategory?.value,
			});
		}
		return out;
	} catch (err) {
		console.warn(`  Wikidata error for [${filter.iris.join(',')}]: ${(err as Error).message}.`);
		return new Map();
	} finally {
		clearTimeout(timeout);
	}
}

/** Wikidata place labels are noisier than OSM `name=*`: "Zagreb" in OSM
 *  often appears in Wikidata as "City of Zagreb", "Town of Senj", "Grad
 *  Senj", "Općina Karlobag", "Brinje, Karlovačka županija", "Lika u
 *  Hrvatskoj", etc. Strip the well-known civic-prefix / suffix patterns
 *  so the diacritic-folded match has a chance to land. */
function normaliseWikidataLabel(raw: string | undefined): string {
	if (!raw) return '';
	let s = foldDiacritics(raw.toLowerCase()).trim();
	// English prefixes
	s = s.replace(/^(city of|town of|municipality of|village of|borough of)\s+/i, '');
	// Croatian prefixes (diacritics already folded above)
	s = s.replace(/^(grad|opcina|naselje|mjesto)\s+/i, '');
	// Trailing parenthetical disambiguators "Zagreb (city)" -> "Zagreb"
	s = s.replace(/\s*\([^)]*\)\s*$/, '');
	// Trailing comma + administrative qualifier "Brinje, Karlovacka zupanija" -> "Brinje".
	// Iterate to strip nested admin chains ("Foo, Bar, Baz").
	while (/,\s*[^,]+$/.test(s)) s = s.replace(/,\s*[^,]+$/, '');
	// Trailing geographic qualifier "Lika u Hrvatskoj" -> "Lika", "Pag in croatia" -> "Pag"
	s = s.replace(/\s+(u hrvatskoj|in croatia)$/i, '');
	return s.trim();
}

/** First whitespace-separated token of a normalized label. Used as a
 *  fallback target so OSM `Velika Gorica` can match Wikidata `Gorica
 *  (selo)` once both sides are normalised. */
function firstToken(s: string): string {
	const i = s.indexOf(' ');
	return i === -1 ? s : s.slice(0, i);
}

/**
 * Matches a POI to a Wikidata place. Three tiers:
 *   0. Exact diacritic-folded equality on either label - also covers
 *      prefix-stripped equality via normaliseWikidataLabel pre-processing.
 *   1. First-token equality across the normalized forms - covers
 *      "Velika Gorica" vs. "Gorica (selo)" and similar bare-stem entries
 *      common on HR Wikidata.
 *   2. Substring containment in either direction after optional prefix
 *      normalization - handles partial / dropped qualifiers like
 *      "Senj" vs. "Senjska Vrata".
 *
 * Proximity guard is 20 km - Wikidata coordinates point at the legal
 * center / town hall, OSM `place=*` nodes sometimes sit at the historic
 * core or a different suburb. 20 km still kicks back true name collisions
 * in distant parts of the country, which is the main false-positive
 * guard now that the substring tier accepts 3-character overlaps.
 *
 * Ties broken by lowest haversine distance.
 */
function matchWikidataByName(wikiData: Map<string, WikidataPlace>, poi: Poi): WikidataPlace | null {
	const targetEn = foldDiacritics(poi.name_en.toLowerCase());
	const targetHr = foldDiacritics(poi.name_hr.toLowerCase());
	const targetEnNorm = normaliseWikidataLabel(poi.name_en);
	const targetHrNorm = normaliseWikidataLabel(poi.name_hr);
	const targets = [targetEn, targetHr, targetEnNorm, targetHrNorm].filter((t) => t.length >= 3);
	if (targets.length === 0) return null;
	const targetFirstTokens = new Set([targetEnNorm, targetHrNorm].map(firstToken).filter((t) => t.length >= 3));

	let best: WikidataPlace | null = null;
	let bestDist = Infinity;
	let bestTier = Infinity;
	for (const wd of wikiData.values()) {
		const labelEn = foldDiacritics((wd.label_en ?? '').toLowerCase());
		const labelHr = foldDiacritics((wd.label_hr ?? '').toLowerCase());
		const labelEnNorm = normaliseWikidataLabel(wd.label_en);
		const labelHrNorm = normaliseWikidataLabel(wd.label_hr);
		const labels = [labelEn, labelHr, labelEnNorm, labelHrNorm].filter((l) => l.length >= 3);
		if (labels.length === 0) continue;
		const labelFirstTokens = [labelEnNorm, labelHrNorm].map(firstToken).filter((l) => l.length >= 3);

		// Pick the best tier this pair lands in. Lower = more confident.
		let tier = Infinity;
		for (const t of targets) {
			for (const l of labels) {
				if (l === t) tier = Math.min(tier, 0);
				else if ((l.includes(t) || t.includes(l)) && Math.min(t.length, l.length) >= 3) {
					// Demand at least 3 characters of overlap; the 20 km coord
					// guard below is the main defense against random short-name
					// collisions across the country.
					tier = Math.min(tier, 2);
				}
			}
		}
		if (tier > 1 && targetFirstTokens.size > 0) {
			for (const l of labelFirstTokens) {
				if (targetFirstTokens.has(l)) {
					tier = Math.min(tier, 1);
					break;
				}
			}
		}
		if (tier === Infinity) continue;

		const dist = haversineM(poi, { lat: wd.lat, lng: wd.lng });
		if (dist > 20_000) continue;
		// Prefer the highest-confidence tier; within a tier prefer the closest.
		if (tier < bestTier || (tier === bestTier && dist < bestDist)) {
			bestTier = tier;
			bestDist = dist;
			best = wd;
		}
	}
	return best;
}

// ---- HPS curated huts ------------------------------------------------------

function matchHpsByNameAndDistance(huts: HpsHutEntry[], poi: Poi): HpsHutEntry | null {
	const target = foldDiacritics(poi.name_en.toLowerCase());
	for (const h of huts) {
		const name = foldDiacritics(h.name.toLowerCase());
		if (!target.includes(name) && !name.includes(target)) continue;
		const dist = haversineM(poi, { lat: h.lat, lng: h.lng });
		if (dist > 500) continue;
		return h;
	}
	return null;
}

// ---- Name + tag helpers ----------------------------------------------------

function pickName(tags: Record<string, string>, locale: 'en' | 'hr'): string {
	const localised = tags[`name:${locale}`];
	if (typeof localised === 'string' && localised.trim().length > 0) return localised.trim();
	return (tags.name ?? '').trim();
}

function parseInteger(raw: string | undefined): number | null {
	if (!raw) return null;
	const n = parseInt(raw.replace(/[^\d.-]/g, ''), 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Returns `raw` only if it parses cleanly as an http(s) URL. OSM tags
 * frequently contain malformed website values (`www.example.hr` without a
 * scheme, plain phone numbers tagged as `website`, etc.) that look fine at
 * first glance but fail strict RFC 3986 validation. Without this guard
 * those rows blow up Ajv's `format: "uri"` check at write time. Any value
 * that fails to parse is silently dropped.
 *
 * A second pass auto-prefixes bare hostnames (`example.hr/foo`) with
 * `https://` so the common "missing scheme" case still produces a usable
 * URL rather than getting discarded.
 */
function safeUrl(raw: string | undefined | null): string | undefined {
	if (!raw) return undefined;
	const trimmed = raw.trim();
	if (!trimmed) return undefined;
	const candidates = /^https?:\/\//i.test(trimmed) ? [trimmed] : [`https://${trimmed}`, trimmed];
	for (const c of candidates) {
		try {
			const u = new URL(c);
			if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
		} catch {
			// try next candidate
		}
	}
	return undefined;
}

/** Replaces em-dash (U+2014) and en-dash (U+2013) with a plain hyphen-minus
 *  (U+002D). Applied to every string field on each POI before the file is
 *  written - even when upstream sources (Wikipedia, Commons, OSM) emit
 *  these characters in names or descriptions. */
function normalizeDashes(s: string): string {
	return s.replace(/[–—]/g, '-');
}

/** Applies normalizeDashes to every visible-text string field of a POI
 *  (names, summaries, notes, season, phone, attribution). Numeric fields
 *  and URL fields (url, image, wikipedia, wikidata) are intentionally
 *  excluded - they never surface as user-reading text and dash-normalizing
 *  a URL would break it. */
function normalizePoiDashes(poi: Poi): Poi {
	return {
		...poi,
		name_en: normalizeDashes(poi.name_en),
		name_hr: normalizeDashes(poi.name_hr),
		...(poi.summary_en !== undefined && { summary_en: normalizeDashes(poi.summary_en) }),
		...(poi.summary_hr !== undefined && { summary_hr: normalizeDashes(poi.summary_hr) }),
		...(poi.note_en !== undefined && { note_en: normalizeDashes(poi.note_en) }),
		...(poi.note_hr !== undefined && { note_hr: normalizeDashes(poi.note_hr) }),
		...(poi.season !== undefined && { season: normalizeDashes(poi.season) }),
		...(poi.phone !== undefined && { phone: normalizeDashes(poi.phone) }),
		...(poi.images !== undefined && {
			images: poi.images.map((img) => ({
				...img,
				...(img.attribution !== undefined && { attribution: normalizeDashes(img.attribution) }),
			})),
		}),
	};
}

function slug(name: string): string {
	return name
		.toLowerCase()
		.replace(/đ/g, 'dj')
		.replace(/[čć]/g, 'c')
		.replace(/š/g, 's')
		.replace(/ž/g, 'z')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

// ---- Merge ------------------------------------------------------------------

// ---- Wikimedia Commons gallery pass ---------------------------------------

const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';
const COMMONS_THUMB_WIDTH = 600;
const COMMONS_MAX_IMAGES_PER_POI = 4;
/** How many category members to consider before filtering by thumbnail
 *  availability + accumulating up to COMMONS_MAX_IMAGES_PER_POI. */
const COMMONS_CATEGORY_FETCH_LIMIT = 12;
const COMMONS_BATCH_SIZE = 50;
/** Number of simultaneous Commons category fetches per batch.
 * Concurrent within each batch, one small sleep between batches
 * so we stay well under Wikimedia rate limits. */
const COMMONS_CATEGORY_FETCH_BATCH = 8;
const COMMONS_CATEGORY_PAUSE_MS = 200;

/**
 * Populates `poi.images` for every POI that we can resolve to one or more
 * Wikimedia Commons files. Inputs:
 *   - the primary Wikidata P18 image (URL stored on `poi.image` by Pass 2)
 *   - up to COMMONS_CATEGORY_FETCH_LIMIT additional members of the POI's
 *     Wikidata commonsCategory (P373)
 *
 * Resolution flow:
 *   1. Build `(poi -> File titles[])` mapping by parsing the P18 URL and
 *      listing category members.
 *   2. Batch the unique File titles into Commons API `imageinfo` calls
 *      (50 per call) to get url / thumb / extmetadata.
 *   3. Reassemble per-poi `images[]` arrays, capped at
 *      COMMONS_MAX_IMAGES_PER_POI, P18 first, category members after.
 *
 * Failures (no QID, no category, API error) silently leave `poi.images`
 * unset - the renderer falls back to the legacy `poi.image` field.
 */
async function populatePhotoGalleries(byId: Map<string, Poi>, wdByPoiId: Map<string, WikidataPlace>): Promise<void> {
	const candidatesByPoi = new Map<string, string[]>();
	const allTitles = new Set<string>();

	// Step 1a: seed candidate File titles from the primary P18 image URL.
	for (const poi of byId.values()) {
		const titles: string[] = [];
		const fromImage = fileTitleFromCommonsUrl(poi.image);
		if (fromImage) titles.push(fromImage);
		if (titles.length > 0) candidatesByPoi.set(poi.id, titles);
	}

	// Step 1b: pull category members for POIs that have a P373 category.
	// Fetches are batched concurrently (COMMONS_CATEGORY_FETCH_BATCH at a time)
	// with a short sleep between batch groups to respect Wikimedia rate limits.
	const categoryWork: { poi: Poi; category: string }[] = [];
	for (const poi of byId.values()) {
		const wd = wdByPoiId.get(poi.id);
		if (!wd?.commonsCategory) continue;
		categoryWork.push({ poi, category: wd.commonsCategory });
	}
	let categoryFetches = 0;
	for (let i = 0; i < categoryWork.length; i += COMMONS_CATEGORY_FETCH_BATCH) {
		const batch = categoryWork.slice(i, i + COMMONS_CATEGORY_FETCH_BATCH);
		await Promise.allSettled(
			batch.map(async ({ poi, category }) => {
				const members = await fetchCommonsCategoryMembers(category, COMMONS_CATEGORY_FETCH_LIMIT);
				categoryFetches++;
				if (members.length === 0) return;
				const existing = candidatesByPoi.get(poi.id) ?? [];
				const existingSet = new Set(existing);
				for (const m of members) {
					if (existingSet.has(m)) continue;
					existing.push(m);
					existingSet.add(m);
					if (existing.length >= COMMONS_MAX_IMAGES_PER_POI + 1) break;
				}
				candidatesByPoi.set(poi.id, existing);
			}),
		);
		if (i + COMMONS_CATEGORY_FETCH_BATCH < categoryWork.length) await sleep(COMMONS_CATEGORY_PAUSE_MS);
	}
	console.log(`  Fetched ${categoryFetches} Commons categories.`);

	for (const titles of candidatesByPoi.values()) for (const t of titles) allTitles.add(t);
	if (allTitles.size === 0) {
		console.log('  No Commons files to fetch.');
		return;
	}
	console.log(`  Resolving ${allTitles.size} unique Commons files...`);

	// Step 2: batch imageinfo lookups so we get url/thumb/license/credit.
	const meta = await fetchCommonsImageInfo([...allTitles]);
	console.log(`  Resolved metadata for ${meta.size} files.`);

	// Step 3: reassemble per-POI image arrays, P18 first.
	let withImages = 0;
	for (const [poiId, titles] of candidatesByPoi) {
		const poi = byId.get(poiId);
		if (!poi) continue;
		const images: PoiImage[] = [];
		for (const title of titles) {
			const m = meta.get(title);
			if (!m) continue;
			images.push(m);
			if (images.length >= COMMONS_MAX_IMAGES_PER_POI) break;
		}
		if (images.length > 0) {
			poi.images = images;
			withImages++;
		}
	}
	console.log(`  Attached gallery to ${withImages} POIs.`);
}

/** Parse a Commons file URL (typical Wikidata P18 form) into a `File:Foo.jpg`
 *  title that the Commons MediaWiki API understands. Returns null for URLs
 *  that don't look like Commons file paths. */
function fileTitleFromCommonsUrl(url: string | undefined): string | null {
	if (!url) return null;
	try {
		const u = new URL(url);
		// Special:FilePath/Foo.jpg
		const fp = u.pathname.match(/\/Special:FilePath\/(.+)$/);
		if (fp) return 'File:' + decodeURIComponent(fp[1]).replace(/_/g, ' ');
		// /wiki/File:Foo.jpg
		const wf = u.pathname.match(/\/wiki\/(File:.+)$/);
		if (wf) return decodeURIComponent(wf[1]).replace(/_/g, ' ');
		// commons.wikimedia.org/wiki/Special:FilePath/Foo.jpg - covered by fp
		// upload.wikimedia.org/.../Foo.jpg - extract the trailing filename
		const upload = u.pathname.match(/\/([^/]+\.(?:jpe?g|png|svg|webp|gif|tif?f))$/i);
		if (upload) return 'File:' + decodeURIComponent(upload[1]).replace(/_/g, ' ');
		return null;
	} catch {
		return null;
	}
}

/** Lists members of a Commons category. Returns an array of `File:Foo.jpg`
 *  titles, filtered to image extensions so non-image members (PDFs, audio)
 *  don't leak into the gallery. */
async function fetchCommonsCategoryMembers(category: string, limit: number): Promise<string[]> {
	// Wikidata P373 values are user-edited free text; cap to a sane length so
	// a hostile or accidentally-huge string can't be reflected into a URL.
	const cat = (category.startsWith('Category:') ? category : `Category:${category}`).slice(0, 200);
	const params = new URLSearchParams({
		action: 'query',
		list: 'categorymembers',
		cmtitle: cat,
		cmtype: 'file',
		cmlimit: String(limit),
		format: 'json',
		formatversion: '2',
	});
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), WIKIDATA_TIMEOUT_MS);
	try {
		const res = await fetch(`${COMMONS_API_URL}?${params.toString()}`, {
			headers: { accept: 'application/json', 'user-agent': USER_AGENT },
			signal: controller.signal,
		});
		if (!res.ok) return [];
		const json = (await res.json()) as { query?: { categorymembers?: { title: string }[] } };
		const members = json.query?.categorymembers ?? [];
		return members.map((m) => m.title).filter((t) => /\.(jpe?g|png|webp|svg|gif|tif?f)$/i.test(t));
	} catch {
		return [];
	} finally {
		clearTimeout(timeout);
	}
}

/** Batches Commons `imageinfo` lookups (50 titles per request) to retrieve
 *  the full URL, thumbnail URL at COMMONS_THUMB_WIDTH, and extmetadata
 *  (artist, license). Returns a per-title PoiImage map. Missing entries
 *  simply don't appear in the result map - callers iterate their candidate
 *  list and skip misses. */
async function fetchCommonsImageInfo(titles: string[]): Promise<Map<string, PoiImage>> {
	const out = new Map<string, PoiImage>();
	for (let i = 0; i < titles.length; i += COMMONS_BATCH_SIZE) {
		const batch = titles.slice(i, i + COMMONS_BATCH_SIZE);
		const params = new URLSearchParams({
			action: 'query',
			titles: batch.join('|'),
			prop: 'imageinfo',
			iiprop: 'url|extmetadata',
			iiurlwidth: String(COMMONS_THUMB_WIDTH),
			iiextmetadatafilter: 'Artist|LicenseShortName|License',
			format: 'json',
			formatversion: '2',
		});
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), WIKIDATA_TIMEOUT_MS);
		try {
			const res = await fetch(`${COMMONS_API_URL}?${params.toString()}`, {
				headers: { accept: 'application/json', 'user-agent': USER_AGENT },
				signal: controller.signal,
			});
			if (!res.ok) continue;
			const json = (await res.json()) as {
				query?: {
					pages?: {
						title: string;
						imageinfo?: {
							url: string;
							thumburl?: string;
							descriptionurl?: string;
							extmetadata?: Record<string, { value: string }>;
						}[];
					}[];
				};
			};
			for (const p of json.query?.pages ?? []) {
				const info = p.imageinfo?.[0];
				if (!info?.url) continue;
				const ext = info.extmetadata ?? {};
				// Pre-sanitize every URL we emit so the schema's format: "uri"
				// check can't fail on a stray Commons response with a weird
				// descriptionurl (rare, but it does happen for redirected
				// files). Skip the file entirely if even the primary url is
				// unusable.
				const url = safeUrl(info.url);
				if (!url) continue;
				out.set(p.title, {
					url,
					thumbUrl: safeUrl(info.thumburl),
					attribution: ext.Artist?.value ? stripHtml(ext.Artist.value) : undefined,
					license: ext.LicenseShortName?.value ?? ext.License?.value,
					sourceUrl: safeUrl(info.descriptionurl),
				});
			}
		} catch {
			// One bad batch shouldn't sink the whole pass; carry on.
		} finally {
			clearTimeout(timeout);
		}
		if (i + COMMONS_BATCH_SIZE < titles.length) await sleep(300);
	}
	return out;
}

/** Strip HTML tags from Commons `Artist` extmetadata (often wrapped in
 *  `<a>` / `<span>` markup). Keeps text + collapses whitespace. Decodes
 *  the common named and numeric HTML entities, so the stored attribution
 *  string is clean plain text. */
function stripHtml(s: string): string {
	return (
		s
			.replace(/<[^>]+>/g, ' ')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(+n))
			.replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
			// Strip Unicode bidirectional control characters to prevent visual
			// spoofing of attribution text in popups (U+202A-U+202E, U+2066-U+2069,
			// U+200E, U+200F).
			.replace(/[‎‏‪-‮⁦-⁩]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
	);
}

// ---- Wikipedia summary pass (Phase 5) -------------------------------------

const WIKIPEDIA_FETCH_BATCH = 6;
const WIKIPEDIA_PAUSE_BETWEEN_BATCHES_MS = 250;
const WIKIPEDIA_TIMEOUT_MS = 15_000;
const WIKIPEDIA_EXTRACT_MAX_CHARS = 320;

function truncateExtract(extract: string, maxLen = WIKIPEDIA_EXTRACT_MAX_CHARS): string {
	if (extract.length <= maxLen) return extract;
	const slice = extract.slice(0, maxLen);
	const lastPeriod = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
	if (lastPeriod > maxLen * 0.5) return slice.slice(0, lastPeriod + 1);
	return slice.trimEnd() + '...';
}

interface SummaryFetch {
	locale: string;
	extract: string;
}

/**
 * Fetches the Wikipedia REST summary for a single article. Returns the
 * extract verbatim (truncate at the call site) or null on any failure
 * (404, network, JSON parse). Failures are common - Wikipedia gets the
 * article-title mapping wrong all the time for disambiguated pages.
 */
async function fetchWikipediaSummaryRest(locale: string, title: string): Promise<string | null> {
	const url = WIKIPEDIA_SUMMARY_HOST_TEMPLATE.replace('{locale}', locale) + encodeURIComponent(title);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), WIKIPEDIA_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			headers: { accept: 'application/json', 'user-agent': USER_AGENT },
			signal: controller.signal,
		});
		if (!res.ok) return null;
		const json = (await res.json()) as { extract?: string };
		return json.extract ?? null;
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Walks every POI with a `wikipedia` field set, fetches its REST summary in
 * batches of WIKIPEDIA_FETCH_BATCH at a time, and writes the truncated
 * extract back to `poi.summary_en` (and `summary_hr` when an explicit hr
 * locale is detected or a Croatian counterpart is found).
 *
 * Strategy:
 *   - If `poi.wikipedia` parses to an English ref, fetch en and write
 *     summary_en. Also try the hr counterpart speculatively using the
 *     same title - works for proper nouns like "Zagreb" where the article
 *     name is identical across wikis.
 *   - If it parses to an hr ref, fetch hr first and write summary_hr;
 *     same speculative attempt for the en counterpart.
 *   - Throttled to avoid Wikipedia's "no more than 200 req/s per user"
 *     soft cap. We're way under, but the pause keeps connection reuse
 *     friendly.
 */
async function populateWikipediaSummaries(byId: Map<string, Poi>): Promise<void> {
	const work: { poi: Poi; primary: 'en' | 'hr'; title: string }[] = [];
	for (const poi of byId.values()) {
		if (!poi.wikipedia) continue;
		const parsed = parseWikipediaRef(poi.wikipedia);
		if (!parsed) continue;
		const primary = parsed.locale === 'hr' ? 'hr' : 'en';
		work.push({ poi, primary, title: parsed.title });
	}
	if (work.length === 0) {
		console.log('  No POIs with `wikipedia` field; skipping summary bake.');
		return;
	}
	console.log(`  Fetching summaries for ${work.length} POIs...`);

	let en = 0;
	let hr = 0;
	let failed = 0;

	for (let i = 0; i < work.length; i += WIKIPEDIA_FETCH_BATCH) {
		const batch = work.slice(i, i + WIKIPEDIA_FETCH_BATCH);
		const results = await Promise.allSettled(
			batch.map(async (item): Promise<SummaryFetch[]> => {
				// Fetch primary and speculative counterpart locale in parallel
				// (the two REST calls are independent, serializing them doubles
				// per-item wall time inside the batch).
				const counterpart = item.primary === 'en' ? 'hr' : 'en';
				const [primaryExtract, counterpartExtract] = await Promise.all([
					fetchWikipediaSummaryRest(item.primary, item.title),
					fetchWikipediaSummaryRest(counterpart, item.title),
				]);
				const out: SummaryFetch[] = [];
				if (primaryExtract) out.push({ locale: item.primary, extract: primaryExtract });
				if (counterpartExtract) out.push({ locale: counterpart, extract: counterpartExtract });
				return out;
			}),
		);
		for (let j = 0; j < results.length; j++) {
			const r = results[j];
			const item = batch[j];
			if (r.status !== 'fulfilled' || r.value.length === 0) {
				failed++;
				continue;
			}
			for (const fetched of r.value) {
				const truncated = truncateExtract(fetched.extract);
				if (fetched.locale === 'en' && !item.poi.summary_en) {
					item.poi.summary_en = truncated;
					en++;
				} else if (fetched.locale === 'hr' && !item.poi.summary_hr) {
					item.poi.summary_hr = truncated;
					hr++;
				}
			}
		}
		await sleep(WIKIPEDIA_PAUSE_BETWEEN_BATCHES_MS);
	}
	console.log(`  Baked ${en} en + ${hr} hr summaries (${failed} POIs returned no summary in either locale).`);
}

function mergePreservingCurated(
	fresh: Poi[],
	prior: Poi[],
	failedTypes: Set<string> = new Set(),
	croatiaPolys: Ring[][] = [],
): Poi[] {
	const priorById = new Map(prior.map((p) => [p.id, p]));
	const today = isoDate(new Date());
	const out: Poi[] = [];
	for (const f of fresh) {
		const p = priorById.get(f.id);
		// Source upgrade: an explicit `curated` in the prior file is the
		// strongest signal and always wins. Otherwise, the freshly computed
		// source (set by passes 1-3 above) sticks.
		const source = p?.source === 'curated' ? 'curated' : f.source;
		out.push({
			...f,
			...(p?.note_en !== undefined && !f.note_en && { note_en: p.note_en }),
			...(p?.note_hr !== undefined && !f.note_hr && { note_hr: p.note_hr }),
			// Carry forward prior `url` only if it still passes the http(s)
			// guard - prevents a historical bad value from re-blowing the
			// schema check after the fresh pass dropped it intentionally.
			...((): { url?: string } => {
				if (f.url || p?.url === undefined) return {};
				const u = safeUrl(p.url);
				return u ? { url: u } : {};
			})(),
			...(p?.tags !== undefined && { tags: p.tags }),
			...(p?.phone !== undefined && !f.phone && { phone: p.phone }),
			...(p?.capacity !== undefined && f.capacity === undefined && { capacity: p.capacity }),
			...(p?.season !== undefined && !f.season && { season: p.season }),
			// Preserve curated galleries: if prior had `images[]` and the new
			// Commons pass returned nothing for this POI, keep what was there.
			...(p?.images && p.images.length > 0 && (!f.images || f.images.length === 0) && { images: p.images }),
			// Preserve baked Wikipedia summaries when Pass 5 fails to refresh
			// them - otherwise a single bad Wikipedia day silently strips
			// every popup of its description until the next successful run.
			...(p?.summary_en !== undefined && !f.summary_en && { summary_en: p.summary_en }),
			...(p?.summary_hr !== undefined && !f.summary_hr && { summary_hr: p.summary_hr }),
			...(source && { source }),
			lastVerified: today,
		});
	}
	// Carry any purely curated rows that the enricher passes didn't rediscover
	// (e.g., a hand-added POI not present in OSM). Without this, manually added
	// entries would silently vanish every time the GH Action runs.
	//
	// Also carry forward every prior entry whose POI type appears in
	// `failedTypes` - a transient Overpass timeout on `peak` shouldn't
	// silently drop 2,889 mountains from the dataset. The user re-runs when
	// upstream is healthy, and the fresh entries replace the carried ones
	// naturally.
	const outIds = new Set(out.map((o) => o.id));
	let carriedFailed = 0;
	let droppedBoundary = 0;
	for (const p of prior) {
		if (outIds.has(p.id)) continue;
		const isCurated = p.source === 'curated';
		const isFailedType = failedTypes.has(p.type);
		if (!isCurated && !isFailedType) continue;
		// Boundary check during carry-forward too: an out-of-Croatia entry
		// introduced before the Croatia boundary filter was added must not
		// survive the merge just because its type's fresh query failed.
		// Curated rows opt out so the user can hand-place reference points
		// outside the border (e.g., a Slovenian rail station near the
		// Istrian border) if they explicitly choose to.
		if (!isCurated && croatiaPolys.length > 0 && !pointInCroatia(p.lat, p.lng, croatiaPolys)) {
			droppedBoundary++;
			continue;
		}
		out.push({ ...p, lastVerified: p.lastVerified ?? today });
		if (isFailedType && !isCurated) carriedFailed++;
	}
	if (carriedFailed > 0) {
		console.log(
			`  Carried forward ${carriedFailed} prior entries of types that failed this run: ${[...failedTypes].join(', ')}.`,
		);
	}
	if (droppedBoundary > 0) {
		console.log(`  Merge step also dropped ${droppedBoundary} prior entries that fell outside Croatia.`);
	}
	return out;
}

// ---- Helpers ---------------------------------------------------------------

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

async function readJsonOptional<T>(p: string): Promise<T | null> {
	try {
		const raw = await fs.readFile(p, 'utf8');
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

function isoDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function round(n: number, places: number): number {
	const f = 10 ** places;
	return Math.round(n * f) / f;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function histogram<T>(items: T[], key: (i: T) => string): Array<[string, number]> {
	const counts = new Map<string, number>();
	for (const item of items) {
		const k = key(item);
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function fail(msg: string): never {
	console.error(`X ${msg}`);
	process.exit(1);
}

main().catch((err) => {
	console.error('POI enrichment failed:', err);
	process.exit(1);
});
