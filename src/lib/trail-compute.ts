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
	hasElevation: boolean;
	/** One entry per GPX vertex in file (SOBO) order: coordinates, elevation (0
	 *  where the GPX has no <ele>), cumulative distance, gain and loss, section,
	 *  bearing and grade. The only copy of the route: consumers build what else
	 *  they need (Leaflet points, distance arrays) from it. */
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
 * Builds the trail dataset from raw track points: the enhanced point array
 * (cumulative distance/gain/loss, section, bearing, grade) and metadata
 * totals. Everything is in file (SOBO) order and the same for both directions;
 * src/lib/trail-frame.ts converts to the hiker's travel frame at the display
 * edges.
 */
export function computeTrailData(points: { lat: number; lng: number; ele?: number }[]): ComputedTrailData {
	if (points.length === 0) throw new Error('GPX track has no points');

	const hasElevation = points.some((p) => p.ele !== undefined && p.ele !== null);
	const elevations = points.map((p) => p.ele ?? 0);

	const enhanced: EnhancedTrailPoint[] = [];
	let cumulativeDistance = 0;
	let cumulativeElevGain = 0;
	let cumulativeElevLoss = 0;

	for (let i = 0; i < points.length; i++) {
		if (i > 0) {
			cumulativeDistance += haversineDistanceM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
			const elevDiff = elevations[i] - elevations[i - 1];
			if (elevDiff > 0) cumulativeElevGain += elevDiff;
			else cumulativeElevLoss += Math.abs(elevDiff);
		}

		const distKm = cumulativeDistance / 1000;
		const section = TRAIL_SECTIONS.find((s) => distKm >= s.startKm && distKm < s.endKm);

		const bearingDeg =
			i < points.length - 1 ? computeBearing(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng) : 0;

		let gradePct = 0;
		if (i < points.length - 1) {
			const dEle = elevations[i + 1] - elevations[i];
			const dDist = haversineDistanceM(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
			gradePct = dDist > 0 ? (dEle / dDist) * 100 : 0;
		}
		const gradeBand = bucketGradePct(Math.abs(gradePct));

		enhanced.push({
			lat: points[i].lat,
			lng: points[i].lng,
			elevation: elevations[i] || 0,
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

	const first = points[0];
	const last = points[points.length - 1];
	return {
		hasElevation,
		enhanced,
		metadata: {
			startPoint: { lat: first.lat, lng: first.lng },
			endPoint: { lat: last.lat, lng: last.lng },
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
