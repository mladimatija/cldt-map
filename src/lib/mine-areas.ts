/**
 * Mine-suspected areas (MSP - minski sumnjiva podrucja).
 *
 * Croatia carried mine contamination from the 1991-1995 war, concentrated in
 * Lika, Karlovac, Sisak-Moslavina, and the Zadar hinterland - squarely in
 * the CLDT corridor - until it was officially declared mine-free on
 * 2026-03-01 (Ottawa Convention fulfilled). The official MSP dataset
 * (formerly published by MUP/HCR via misportal.hcr.hr) is no longer
 * maintained, so the bundled dataset ships empty and this whole feature is
 * dormant: nothing renders, no toggle appears. The pipeline stays in place
 * in case residual-risk or UXO data is ever published again.
 *
 * `scripts/update-mine-areas.ts` converts the official data into the bundled
 * `public/data/mine-areas.json` consumed here: polygons near the trail plus
 * precomputed trail km ranges that cross or come near them. This module holds
 * the shared types and the pure geometry helpers used by both the script and
 * the runtime layer / banner.
 *
 * SAFETY FRAMING: this is informational only. Absence of a polygon never
 * means "safe", and the UI must always show the data date and point at the
 * official source. On-site signage wins over anything this app renders.
 */

import type * as GeoJSON from 'geojson';
import { pointInPolygon } from './point-in-polygon';

/** A hiker closer than this to a polygon edge gets the "near" warning. */
export const MINE_NEAR_BUFFER_M = 500;

export interface MineArea {
	/** Stable id (from the source attributes when available, else derived). */
	id: string;
	/** Optional human-readable label (municipality / county). */
	name?: string;
	/** WGS84 polygon(s), GeoJSON coordinate order [lng, lat]. */
	geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
	/** [west, south, east, north] - cheap prefilter before exact tests. */
	bbox: [number, number, number, number];
	/** SOBO km of the closest trail point. */
	nearestTrailKm?: number;
	/** Distance (m) from the polygon to the closest trail point. */
	distanceFromTrailM?: number;
}

export interface MineTrailRange {
	/** SOBO km where the affected stretch starts. */
	startKm: number;
	/** SOBO km where the affected stretch ends. */
	endKm: number;
	/** "crosses" = the trail enters the polygon; "near" = within the buffer. */
	proximity: 'crosses' | 'near';
	areaId: string;
}

export interface MineAreasFile {
	/** ISO date of the source data snapshot; empty string when never run. */
	lastUpdated: string;
	/** Attribution line for the popup. */
	source: string;
	areas: MineArea[];
	trailRanges: MineTrailRange[];
}

/** True when the bundled dataset actually carries polygons (the repo ships an
 *  empty file until `npm run update-mine-areas` is executed). */
export function hasMineAreas(file: MineAreasFile | null): file is MineAreasFile {
	return !!file && file.areas.length > 0;
}

/** Point-in-expanded-bbox prefilter; `padDeg` ~ 0.006 covers 500 m. */
export function inBbox(lat: number, lng: number, bbox: [number, number, number, number], padDeg: number): boolean {
	return lng >= bbox[0] - padDeg && lng <= bbox[2] + padDeg && lat >= bbox[1] - padDeg && lat <= bbox[3] + padDeg;
}

const M_PER_DEG_LAT = 111_320;

/** Equirectangular point-to-segment distance in metres. Accurate to well
 *  under a percent at the sub-kilometre scales the buffer check needs. */
function pointToSegmentM(lat: number, lng: number, aLng: number, aLat: number, bLng: number, bLat: number): number {
	const kx = Math.cos((lat * Math.PI) / 180) * M_PER_DEG_LAT;
	const ky = M_PER_DEG_LAT;
	const ax = (aLng - lng) * kx;
	const ay = (aLat - lat) * ky;
	const bx = (bLng - lng) * kx;
	const by = (bLat - lat) * ky;
	const dx = bx - ax;
	const dy = by - ay;
	const lenSq = dx * dx + dy * dy;
	let t = lenSq === 0 ? 0 : -(ax * dx + ay * dy) / lenSq;
	t = Math.max(0, Math.min(1, t));
	const px = ax + t * dx;
	const py = ay + t * dy;
	return Math.sqrt(px * px + py * py);
}

function ringsOf(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Position[][] {
	return geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
}

/** Minimum distance (m) from a point to the geometry's edges. Returns 0 when
 *  the point is inside. */
export function distanceToMineAreaM(
	lat: number,
	lng: number,
	geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): number {
	if (pointInPolygon([lng, lat], geometry)) return 0;
	let min = Infinity;
	for (const ring of ringsOf(geometry)) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const d = pointToSegmentM(lat, lng, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
			if (d < min) min = d;
		}
	}
	return min;
}

export type MineProximity = 'inside' | 'near' | null;

/** Classifies a GPS fix against one area: inside the polygon, within the
 *  warning buffer, or clear. The bbox prefilter keeps the per-fix cost
 *  negligible for fixes nowhere near contamination. */
export function classifyMineProximity(lat: number, lng: number, area: MineArea): MineProximity {
	if (!inBbox(lat, lng, area.bbox, 0.006)) return null;
	if (pointInPolygon([lng, lat], area.geometry)) return 'inside';
	return distanceToMineAreaM(lat, lng, area.geometry) <= MINE_NEAR_BUFFER_M ? 'near' : null;
}
