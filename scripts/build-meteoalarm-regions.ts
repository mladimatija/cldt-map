/**
 * Builds the Croatian county outlines severe-weather warnings are drawn on:
 * public/data/meteoalarm-regions-hr.json, a static file the client loads once.
 *
 * DHMZ issues land warnings per county. Each MeteoAlarm area carries a county
 * EMMA_ID (HR011-HR031) together with the county's NUTS 2021 level 3 code
 * (HR021-HR065). MeteoAlarm's own geocodes file still describes the older
 * eight regions (HR001-HR008), so the county outlines come from Eurostat GISCO
 * NUTS 2021 at 1:1 million, the finest scale GISCO lets anyone redistribute.
 * GISCO grants use for non-commercial purposes with the EuroGeographics credit,
 * which the map's attribution carries. Sea areas (EMMA_ID HR801-HR806, no NUTS
 * code) are left out: the trail stays on land.
 *
 * The outlines are only rounded (4 decimals, ~10 m), not simplified further:
 * the 1:1M source is already generalised, and simplifying each county on its
 * own would cut shared borders differently, leaving slivers between counties
 * where a hiker would be in no warning area.
 *
 * Usage: npm run build:meteoalarm-regions
 * Commit the regenerated file; the app ships it.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as GeoJSON from 'geojson';
import { mapRings, round, type Ring } from './geometry';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = path.resolve(PROJECT_ROOT, 'public/data/meteoalarm-regions-hr.json');

const SOURCE_URL =
	'https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2021_4326_LEVL_3.geojson';
const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024;
/** 4 decimals is ~10 m, far below the source's own precision; neighbouring
 *  counties share their border vertices, so rounding keeps them identical. */
const COORD_DECIMALS = 4;
/** Croatia has 21 NUTS 3 regions (20 counties and the City of Zagreb). */
const EXPECTED_REGIONS = 21;

interface NutsProperties {
	NUTS_ID: string;
	CNTR_CODE: string;
	NAME_LATN: string;
}

function fail(msg: string): never {
	console.error(`build-meteoalarm-regions failed: ${msg}`);
	process.exit(1);
}

async function download(url: string): Promise<GeoJSON.FeatureCollection<GeoJSON.Geometry, NutsProperties>> {
	const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
	if (!res.ok) fail(`HTTP ${res.status} from ${url}`);
	const length = Number(res.headers.get('content-length') ?? 0);
	if (length > MAX_DOWNLOAD_BYTES) fail(`source is ${length} bytes, over the ${MAX_DOWNLOAD_BYTES} cap`);
	const text = await res.text();
	if (text.length > MAX_DOWNLOAD_BYTES) fail(`source is over the ${MAX_DOWNLOAD_BYTES} byte cap`);
	return JSON.parse(text) as GeoJSON.FeatureCollection<GeoJSON.Geometry, NutsProperties>;
}

function roundRing(ring: Ring): Ring {
	const out: Ring = [];
	for (const [x, y] of ring) {
		const p = [round(x, COORD_DECIMALS), round(y, COORD_DECIMALS)];
		const last = out[out.length - 1];
		if (last?.[0] !== p[0] || last[1] !== p[1]) out.push(p);
	}
	return out.length >= 4 ? out : ring;
}

/** Strip characters the project never ships (en and em dashes). */
function cleanName(name: string): string {
	return name.replace(/[\u2013\u2014]/g, '-').trim();
}

async function main(): Promise<void> {
	console.log(`Downloading ${SOURCE_URL}`);
	const source = await download(SOURCE_URL);
	const counties = source.features.filter((f) => f.properties?.CNTR_CODE === 'HR');
	if (counties.length !== EXPECTED_REGIONS) {
		fail(`expected ${EXPECTED_REGIONS} Croatian NUTS 3 regions, found ${counties.length}`);
	}

	const regions: Record<string, { name: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }> = {};
	let before = 0;
	let after = 0;
	for (const feature of counties.sort((a, b) => a.properties.NUTS_ID.localeCompare(b.properties.NUTS_ID))) {
		const { geometry } = feature;
		if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
			fail(`${feature.properties.NUTS_ID} has a ${geometry.type} geometry`);
		}
		const rounded = mapRings(geometry, roundRing);
		const count = (g: GeoJSON.Polygon | GeoJSON.MultiPolygon): number =>
			(g.type === 'Polygon' ? [g.coordinates] : g.coordinates).reduce(
				(sum, poly) => sum + poly.reduce((n, ring) => n + ring.length, 0),
				0,
			);
		before += count(geometry);
		after += count(rounded);
		regions[feature.properties.NUTS_ID] = { name: cleanName(feature.properties.NAME_LATN), geometry: rounded };
	}

	const output = {
		source: 'Eurostat GISCO, NUTS 2021 level 3, 1:1 million (NUTS_RG_01M_2021_4326_LEVL_3)',
		licence:
			'GISCO terms: free for non-commercial use with the EuroGeographics credit (https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units)',
		attribution: '© EuroGeographics for the administrative boundaries',
		generatedAt: new Date().toISOString(),
		regions,
	};
	await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
	await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output)}\n`, 'utf8');
	const bytes = (await fs.stat(OUTPUT_PATH)).size;
	console.log(
		`Wrote ${Object.keys(regions).length} regions to ${path.relative(PROJECT_ROOT, OUTPUT_PATH)}: ${before} -> ${after} vertices, ${bytes} bytes`,
	);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
