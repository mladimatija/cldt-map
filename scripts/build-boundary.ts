/**
 * Builds the Croatia outline the map draws and clips base tiles to:
 * public/data/croatia-boundary-display.json, which the client fetches on first
 * use instead of bundling the full outline.
 *
 * The source is public/data/geoJsonHr.json, the OpenStreetMap boundary
 * relation from Nominatim (about 35,700 vertices, 1.1 MB), which the data
 * scripts keep using at full detail. The display copy is simplified with
 * Douglas-Peucker at 0.0001 degrees and rounded to 5 decimals (about 1 m):
 * it stays within about 11 m of the source, a few pixels at zoom 16, where a
 * coarser outline would visibly shift the clipped tile edge at land borders.
 *
 * Usage: npm run build:boundary
 * Commit the regenerated file; the app ships it.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as GeoJSON from 'geojson';
import { mapRings, round, simplifyRing } from './geometry';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PATH = path.resolve(PROJECT_ROOT, 'public/data/geoJsonHr.json');
const OUTPUT_PATH = path.resolve(PROJECT_ROOT, 'public/data/croatia-boundary-display.json');

/** About 11 m north-south and 8 m east-west at Croatia's latitude. */
const SIMPLIFY_TOLERANCE_DEG = 0.0001;
const COORD_DECIMALS = 5;

interface NominatimBoundary {
	licence: string;
	geojson: GeoJSON.MultiPolygon;
}

function vertexCount(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
	const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
	return polygons.reduce((sum, polygon) => sum + polygon.reduce((n, ring) => n + ring.length, 0), 0);
}

async function main(): Promise<void> {
	const source = JSON.parse(await fs.readFile(SOURCE_PATH, 'utf8')) as NominatimBoundary;
	if (source.geojson?.type !== 'MultiPolygon') {
		console.error('build-boundary failed: the source is not a MultiPolygon');
		process.exit(1);
	}

	const geometry = mapRings(source.geojson, (ring) =>
		simplifyRing(ring, SIMPLIFY_TOLERANCE_DEG).map(([x, y]) => [round(x, COORD_DECIMALS), round(y, COORD_DECIMALS)]),
	);
	const output = {
		type: 'FeatureCollection',
		licence: source.licence,
		features: [{ type: 'Feature', properties: {}, geometry }],
	};
	const json = JSON.stringify(output);
	await fs.writeFile(OUTPUT_PATH, json + '\n');
	console.log(
		`Wrote ${path.relative(PROJECT_ROOT, OUTPUT_PATH)}: ${vertexCount(geometry)} vertices ` +
			`(source ${vertexCount(source.geojson)}), ${(json.length / 1024).toFixed(0)} KB`,
	);
}

void main();
