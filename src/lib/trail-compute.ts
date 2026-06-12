/**
 * Pure, Leaflet-free trail computation: GPX track parse + enhanced-point
 * construction + metadata totals. Runs inside the trail Web Worker so a
 * ~100k-point GPX never blocks the main thread on cold load; also directly
 * testable in Node.
 *
 * Semantics mirror the historical main-thread path (gpx-parser.ts +
 * trail-slice processTrailData) with one deliberate difference: distances
 * use the haversine formula instead of Leaflet's spherical law of cosines.
 * Both assume R=6371000; the cumulative difference over the full trail is
 * parts-per-million, far below the 0.01 km display rounding.
 */

import { haversineDistanceM } from './haversine';
import { computeBearing } from './distance-utils';
import { TRAIL_SECTIONS } from './trail-sections';
import type { EnhancedTrailPoint, TrailDirection } from './store/types';

const MAX_GPX_BYTES = 20 * 1024 * 1024;

export interface ComputedTrailData {
	/** Direction-adjusted plain coordinates (same order as enhanced). */
	points: { lat: number; lng: number }[];
	/** Direction-adjusted elevation triples (0 where the GPX has no <ele>). */
	elevationPoints: { lat: number; lng: number; elevation: number }[];
	hasElevation: boolean;
	enhanced: EnhancedTrailPoint[];
	metadata: {
		startPoint: { lat: number; lng: number };
		endPoint: { lat: number; lng: number };
		/** Meters. */
		totalDistanceM: number;
		elevationGain: number;
		elevationLoss: number;
	};
}

/** Bucket an absolute grade percent into one of five bands (mirror of
 *  trail-slice's bucketGradePct). */
function bucketGradePct(absGradePct: number): 0 | 1 | 2 | 3 | 4 {
	if (absGradePct <= 3) return 0;
	if (absGradePct <= 6) return 1;
	if (absGradePct <= 10) return 2;
	if (absGradePct <= 15) return 3;
	return 4;
}

/**
 * Regex-based trkpt extraction for the first <trk> of a GPX document.
 * DOMParser does not exist in workers; for the trail GPX (machine-generated
 * trkpt/ele markup) attribute-regex parsing is exact. The same safety gates
 * as gpx-parser.ts apply: size cap and DOCTYPE rejection.
 */
export function parseTrackPoints(xml: string): { lat: number; lng: number; ele?: number }[] {
	if (xml.length > MAX_GPX_BYTES) throw new Error('GPX file is too large');
	if (/<!DOCTYPE/i.test(xml)) throw new Error('GPX file contains unsupported DOCTYPE');

	// First <trk> scope only, mirroring `parsed.tracks[0]`.
	const trkMatch = /<trk[\s>][\s\S]*?<\/trk>/.exec(xml);
	const scope = trkMatch ? trkMatch[0] : xml;

	const points: { lat: number; lng: number; ele?: number }[] = [];
	const trkptRe = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*)\/>/g;
	let m: RegExpExecArray | null;
	while ((m = trkptRe.exec(scope)) !== null) {
		const attrs = m[1] ?? m[3] ?? '';
		const latMatch = /lat="([^"]+)"/.exec(attrs);
		const lonMatch = /lon="([^"]+)"/.exec(attrs);
		if (!latMatch || !lonMatch) continue;
		const lat = parseFloat(latMatch[1]);
		const lng = parseFloat(lonMatch[1]);
		if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
		const point: { lat: number; lng: number; ele?: number } = { lat, lng };
		const body = m[2] ?? '';
		const eleMatch = /<ele>([^<]+)<\/ele>/.exec(body);
		if (eleMatch) {
			const ele = parseFloat(eleMatch[1]);
			if (!Number.isNaN(ele)) point.ele = ele;
		}
		points.push(point);
	}
	return points;
}

/**
 * Builds the full trail dataset from raw track points: direction-adjusted
 * coordinate/elevation arrays, the enhanced point array (cumulative
 * distance/gain/loss, section, bearing, grade), and metadata totals.
 * Port of trail-slice processTrailData's enhancement loop.
 */
export function computeTrailData(
	rawPoints: { lat: number; lng: number; ele?: number }[],
	direction: TrailDirection,
): ComputedTrailData {
	if (rawPoints.length === 0) throw new Error('GPX track has no points');

	const ordered = direction === 'NOBO' ? [...rawPoints].reverse() : rawPoints;
	const hasElevation = rawPoints.some((p) => p.ele !== undefined && p.ele !== null);
	const points = ordered.map(({ lat, lng }) => ({ lat, lng }));
	const elevationPoints = ordered.map(({ lat, lng, ele }) => ({ lat, lng, elevation: ele ?? 0 }));

	const enhanced: EnhancedTrailPoint[] = [];
	let cumulativeDistance = 0;
	let cumulativeElevGain = 0;
	let cumulativeElevLoss = 0;

	for (let i = 0; i < points.length; i++) {
		if (i > 0) {
			cumulativeDistance += haversineDistanceM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
			const elevDiff = elevationPoints[i].elevation - elevationPoints[i - 1].elevation;
			if (elevDiff > 0) cumulativeElevGain += elevDiff;
			else cumulativeElevLoss += Math.abs(elevDiff);
		}

		const distKm = cumulativeDistance / 1000;
		const section = TRAIL_SECTIONS.find((s) => distKm >= s.startKm && distKm < s.endKm);

		const bearingDeg =
			i < points.length - 1 ? computeBearing(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng) : 0;

		let gradePct = 0;
		if (i < points.length - 1) {
			const dEle = elevationPoints[i + 1].elevation - elevationPoints[i].elevation;
			const dDist = haversineDistanceM(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
			gradePct = dDist > 0 ? (dEle / dDist) * 100 : 0;
		}
		const gradeBand = bucketGradePct(Math.abs(gradePct));

		enhanced.push({
			lat: points[i].lat,
			lng: points[i].lng,
			elevation: elevationPoints[i].elevation || 0,
			distanceFromStart: cumulativeDistance,
			elevationGainFromStart: cumulativeElevGain,
			elevationLossFromStart: cumulativeElevLoss,
			index: i,
			sectionName: section?.nameKey,
			bearingDeg,
			gradePct,
			gradeBand,
		});
	}

	// Last point inherits previous bearing/grade (single-point trails keep zeros).
	if (enhanced.length >= 2) {
		const last = enhanced[enhanced.length - 1];
		const prev = enhanced[enhanced.length - 2];
		last.bearingDeg = prev.bearingDeg;
		last.gradePct = prev.gradePct;
		last.gradeBand = prev.gradeBand;
	}

	return {
		points,
		elevationPoints,
		hasElevation,
		enhanced,
		metadata: {
			startPoint: points[0],
			endPoint: points[points.length - 1],
			totalDistanceM: cumulativeDistance,
			elevationGain: cumulativeElevGain,
			elevationLoss: cumulativeElevLoss,
		},
	};
}

/** One-call worker entry: parse + compute. */
export function computeFromGpx(gpxText: string, direction: TrailDirection): ComputedTrailData {
	return computeTrailData(parseTrackPoints(gpxText), direction);
}
