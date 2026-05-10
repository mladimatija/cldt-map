/**
 * Server-side proxy for Meteoalarm CAP-Atom feed (Croatia).
 * Fetches warnings, parses CAP XML with regex (no DOM library),
 * and returns a normalized GeoJSON FeatureCollection.
 */
import { NextResponse } from 'next/server';

import type { Feature, FeatureCollection, Polygon, Position } from 'geojson';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const METEOALARM_URL = 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-croatia';
const FETCH_TIMEOUT_MS = 30_000;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MeteoalarmProperties {
	severity: 'yellow' | 'orange' | 'red';
	event: string;
	validFrom: string;
	validUntil: string;
	source: string;
}

/* ------------------------------------------------------------------ */
/*  XML helpers (regex-based, same pattern as /api/dhmz-weather)       */
/* ------------------------------------------------------------------ */

/** Extract the text content of the first matching XML tag (no nesting). */
function extractTag(xml: string, tag: string): string {
	const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`));
	return match?.[1]?.trim() ?? '';
}

/** Extract the full block between the first <tag>…</tag> (supports nested content). */
function extractBlock(xml: string, tag: string): string {
	const open = new RegExp(`<${tag}[^>]*>`);
	const close = new RegExp(`<\\/${tag}>`);
	const startMatch = open.exec(xml);
	if (!startMatch) return '';
	const closeMatch = close.exec(xml.slice(startMatch.index + startMatch[0].length));
	if (!closeMatch) return '';
	const endIndex = startMatch.index + startMatch[0].length + closeMatch.index + closeMatch[0].length;
	return xml.slice(startMatch.index, endIndex);
}

/** Extract all matching blocks for a given tag. */
function extractAllBlocks(xml: string, tag: string): string[] {
	const blocks: string[] = [];
	const open = new RegExp(`<${tag}[^>]*>`, 'g');
	const close = new RegExp(`<\\/${tag}>`);
	let match: RegExpExecArray | null;
	while ((match = open.exec(xml)) !== null) {
		const rest = xml.slice(match.index + match[0].length);
		const closeMatch = close.exec(rest);
		if (!closeMatch) continue;
		const endIndex = match.index + match[0].length + closeMatch.index + closeMatch[0].length;
		blocks.push(xml.slice(match.index, endIndex));
	}
	return blocks;
}

/* ------------------------------------------------------------------ */
/*  CAP polygon → GeoJSON                                             */
/* ------------------------------------------------------------------ */

/**
 * Parse a CAP polygon string into a GeoJSON Polygon.
 * CAP format: space-separated "lat,lng" pairs.
 * GeoJSON requires [lng, lat] order and a closed ring with ≥ 4 points.
 */
function parseCapPolygon(raw: string): Polygon | null {
	const pairs = raw.trim().split(/\s+/);
	if (pairs.length < 3) return null;

	const coordinates: Position[] = [];
	for (const pair of pairs) {
		const [latStr, lngStr] = pair.split(',');
		const lat = parseFloat(latStr);
		const lng = parseFloat(lngStr);
		if (isNaN(lat) || isNaN(lng)) return null;
		coordinates.push([lng, lat]); // GeoJSON: [lng, lat]
	}

	// Ensure the ring is closed
	const first = coordinates[0];
	const last = coordinates[coordinates.length - 1];
	if (first[0] !== last[0] || first[1] !== last[1]) {
		coordinates.push([...first]);
	}

	// A valid polygon ring needs at least 4 positions
	if (coordinates.length < 4) return null;

	return {
		type: 'Polygon',
		coordinates: [coordinates],
	};
}

/* ------------------------------------------------------------------ */
/*  Severity mapping                                                   */
/* ------------------------------------------------------------------ */

function mapSeverity(capSeverity: string): MeteoalarmProperties['severity'] {
	switch (capSeverity.toLowerCase()) {
		case 'minor':
			return 'yellow';
		case 'moderate':
			return 'orange';
		case 'severe':
		case 'extreme':
			return 'red';
		default:
			return 'yellow';
	}
}

/* ------------------------------------------------------------------ */
/*  Feed parsing                                                       */
/* ------------------------------------------------------------------ */

function parseEntries(xml: string): Feature<Polygon, MeteoalarmProperties>[] {
	const features: Feature<Polygon, MeteoalarmProperties>[] = [];
	const now = new Date();

	const entryParts = xml.split('</entry>');
	for (const part of entryParts) {
		const start = part.lastIndexOf('<entry');
		if (start === -1) continue;
		const entryBlock = part.slice(start);

		// Extract <info> block (contains all warning detail)
		const infoBlock = extractBlock(entryBlock, 'info');
		if (!infoBlock) continue;

		// Core fields
		const severity = mapSeverity(extractTag(infoBlock, 'severity'));
		const event = extractTag(infoBlock, 'event');
		const validFrom = extractTag(infoBlock, 'effective') || extractTag(infoBlock, 'onset');
		const validUntil = extractTag(infoBlock, 'expires');
		const source = extractTag(infoBlock, 'senderName');

		// Filter out past warnings
		if (validUntil) {
			const expiresDate = new Date(validUntil);
			if (!isNaN(expiresDate.getTime()) && expiresDate < now) continue;
		}

		// Extract all <area> blocks, then find <polygon> values in each
		const areaBlocks = extractAllBlocks(infoBlock, 'area');
		for (const area of areaBlocks) {
			const polygonRaw = extractTag(area, 'polygon');
			if (!polygonRaw) continue;

			const geometry = parseCapPolygon(polygonRaw);
			if (!geometry) continue;

			features.push({
				type: 'Feature',
				geometry,
				properties: {
					severity,
					event,
					validFrom,
					validUntil,
					source,
				},
			});
		}
	}

	return features;
}

/* ------------------------------------------------------------------ */
/*  Empty collection (reused in error paths)                           */
/* ------------------------------------------------------------------ */

function emptyCollection(): FeatureCollection {
	return { type: 'FeatureCollection', features: [] };
}

/* ------------------------------------------------------------------ */
/*  Route handler                                                      */
/* ------------------------------------------------------------------ */

const CACHE_HEADERS = {
	'Cache-Control': 'public, max-age=900, s-maxage=900',
};

export async function GET(): Promise<Response> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		const res = await fetch(METEOALARM_URL, {
			signal: controller.signal,
			next: { revalidate: 900 },
		});
		clearTimeout(timeout);

		if (!res.ok) {
			console.error(`[meteoalarm] Upstream returned ${res.status}`);
			return NextResponse.json(emptyCollection(), { headers: CACHE_HEADERS });
		}

		const xml = await res.text();
		const features = parseEntries(xml);

		const collection: FeatureCollection = {
			type: 'FeatureCollection',
			features,
		};

		return NextResponse.json(collection, { headers: CACHE_HEADERS });
	} catch (err) {
		console.error('[meteoalarm]', err);
		return NextResponse.json(emptyCollection(), { headers: CACHE_HEADERS });
	}
}
