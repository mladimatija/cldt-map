/**
 * Server-side proxy for Meteoalarm CAP-Atom feed (Croatia).
 * Fetches warnings, parses CAP XML with regex (no DOM library),
 * and returns a normalized GeoJSON FeatureCollection.
 */
import { NextResponse, type NextRequest } from 'next/server';

import type { Feature, FeatureCollection, Polygon, Position } from 'geojson';

import { enforceRateLimit, fetchWithSizeCap } from '@/lib/api-defense';
import { escapeRegex } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const METEOALARM_URL = 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-croatia';
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

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
/*  XML helpers (regex-based, pre-compiled per tag)                    */
/* ------------------------------------------------------------------ */

const tagRegexCache = new Map<string, RegExp>();
const openRegexCache = new Map<string, RegExp>();
const openRegexGlobalCache = new Map<string, RegExp>();
const closeRegexCache = new Map<string, RegExp>();

function getTagRegex(tag: string): RegExp {
	let r = tagRegexCache.get(tag);
	if (!r) {
		const safe = escapeRegex(tag);
		r = new RegExp(`<${safe}[^>]*>([^<]*)<\\/${safe}>`);
		tagRegexCache.set(tag, r);
	}
	return r;
}

function getOpenRegex(tag: string, global = false): RegExp {
	const cache = global ? openRegexGlobalCache : openRegexCache;
	let r = cache.get(tag);
	if (!r) {
		const safe = escapeRegex(tag);
		r = new RegExp(`<${safe}[^>]*>`, global ? 'g' : undefined);
		cache.set(tag, r);
	}
	if (global) r.lastIndex = 0;
	return r;
}

function getCloseRegex(tag: string): RegExp {
	let r = closeRegexCache.get(tag);
	if (!r) {
		const safe = escapeRegex(tag);
		r = new RegExp(`<\\/${safe}>`);
		closeRegexCache.set(tag, r);
	}
	return r;
}

function extractTag(xml: string, tag: string): string {
	const match = xml.match(getTagRegex(tag));
	return match?.[1]?.trim() ?? '';
}

function extractBlock(xml: string, tag: string): string {
	const startMatch = getOpenRegex(tag).exec(xml);
	if (!startMatch) return '';
	const closeMatch = getCloseRegex(tag).exec(xml.slice(startMatch.index + startMatch[0].length));
	if (!closeMatch) return '';
	const endIndex = startMatch.index + startMatch[0].length + closeMatch.index + closeMatch[0].length;
	return xml.slice(startMatch.index, endIndex);
}

function extractAllBlocks(xml: string, tag: string): string[] {
	const blocks: string[] = [];
	const open = getOpenRegex(tag, true);
	let match: RegExpExecArray | null;
	while ((match = open.exec(xml)) !== null) {
		const rest = xml.slice(match.index + match[0].length);
		const closeMatch = getCloseRegex(tag).exec(rest);
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

const EMPTY_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] };

/* ------------------------------------------------------------------ */
/*  Route handler                                                      */
/* ------------------------------------------------------------------ */

const CACHE_HEADERS = {
	'Cache-Control': 'public, max-age=900, s-maxage=900',
};

export async function GET(request: NextRequest): Promise<Response> {
	const limited = await enforceRateLimit(request, { name: 'meteoalarm', windowMs: 60_000, max: 60 });
	if (limited) return limited;

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		const fetched = await fetchWithSizeCap(
			METEOALARM_URL,
			{
				signal: controller.signal,
				next: { revalidate: 900 },
			},
			MAX_BODY_BYTES,
		);
		clearTimeout(timeout);

		if (!fetched.ok) {
			console.error(`[meteoalarm] ${fetched.reason}`);
			return NextResponse.json(EMPTY_COLLECTION, { headers: CACHE_HEADERS });
		}

		const features = parseEntries(fetched.body);

		const collection: FeatureCollection = {
			type: 'FeatureCollection',
			features,
		};

		return NextResponse.json(collection, { headers: CACHE_HEADERS });
	} catch (err) {
		console.error('[meteoalarm]', err instanceof Error ? err.message : String(err));
		return NextResponse.json(EMPTY_COLLECTION, { headers: CACHE_HEADERS });
	}
}
