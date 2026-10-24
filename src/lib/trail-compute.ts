/**
 * Pure, Leaflet-free trail computation: GPX track parse + enhanced-point
 * construction + metadata totals. The single implementation for the app:
 * it runs inside the trail Web Worker so a ~100k-point GPX never blocks the
 * main thread on cold load, and TrailRoute calls computeFromGpx directly when
 * the worker is unavailable.
 *
 * Distances use the haversine formula (R=6371000), as do the data scripts
 * (scripts/lib/trail.ts), so app and script km agree.
 */

import { haversineDistanceM } from './haversine';
import { computeBearing } from './distance-utils';
import { TRAIL_SECTIONS } from './trail-sections';
import { parseTrackPoints } from './gpx-parser';
import type { EnhancedTrailPoint } from './store/types';

export interface ComputedTrailData {
	/** Plain coordinates in file (SOBO) order, the same order as enhanced. */
	points: { lat: number; lng: number }[];
	/** Elevation triples in file order (0 where the GPX has no <ele>). */
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
 * Builds the full trail dataset from raw track points: coordinate/elevation
 * arrays, the enhanced point array (cumulative distance/gain/loss, section,
 * bearing, grade) and metadata totals. Everything is in file (SOBO) order and
 * the same for both directions; src/lib/trail-frame.ts converts to the
 * hiker's travel frame at the display edges.
 */
export function computeTrailData(rawPoints: { lat: number; lng: number; ele?: number }[]): ComputedTrailData {
	if (rawPoints.length === 0) throw new Error('GPX track has no points');

	const hasElevation = rawPoints.some((p) => p.ele !== undefined && p.ele !== null);
	const points = rawPoints.map(({ lat, lng }) => ({ lat, lng }));
	const elevationPoints = rawPoints.map(({ lat, lng, ele }) => ({ lat, lng, elevation: ele ?? 0 }));

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
export function computeFromGpx(gpxText: string): ComputedTrailData {
	return computeTrailData(parseTrackPoints(gpxText));
}
