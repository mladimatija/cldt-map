import { haversineDistanceM } from '@/lib/haversine';
import type { Poi } from '@/lib/pois';
import type { TrackPoint } from '@/lib/gpx-parser';

/**
 * Closest-pass report for one POI relative to an imported GPX track. The
 * imports panel renders a list of these so the user sees which POIs they
 * actually walked near during their recorded hike.
 */
export interface PoiProximityHit {
	poi: Poi;
	/** Closest haversine distance from any point on the track to the POI. */
	minDistanceM: number;
	/** Cumulative track distance (m) at the closest pass. Useful for
	 *  ordering the report in walking order. */
	atTrackKm: number;
}

const DEFAULT_RADIUS_M = 500;

/** Edge length of one grid cell, in degrees. ~0.01 deg latitude ≈ 1.1 km,
 *  comfortably bigger than DEFAULT_RADIUS_M (500 m) so the 9-cell neighbour
 *  window always covers every track point within the search radius. */
const GRID_CELL_DEG = 0.01;

/**
 * Walks the track and the POI list to find every POI within `radiusM` of
 * any track point. We bucket the track into a coarse lat/lng grid up front,
 * so for each POI we only haversine against track points in the 9 cells
 * (POI cell + 8 neighbours) around it instead of the full track. With a
 * 50k-point recorded hike and 50 nearby POIs that drops 2.5M haversine calls
 * to ~tens of thousands.
 *
 * Returns hits sorted by `atTrackKm` (the order they were passed on the
 * recorded hike) so the report reads chronologically.
 */
export function findPoisNearTrack(track: TrackPoint[], pois: Poi[], radiusM = DEFAULT_RADIUS_M): PoiProximityHit[] {
	if (track.length === 0 || pois.length === 0) return [];

	// Pre-compute a coarse bounding box around the track so we can skip the
	// per-POI cell lookup for POIs that are obviously too far away (e.g. a POI
	// 100 km from the recorded hike). Add radius-equivalent padding in
	// degrees (~111 km per degree latitude).
	const padDeg = radiusM / 111_000;
	let minLat = Infinity,
		maxLat = -Infinity,
		minLng = Infinity,
		maxLng = -Infinity;
	for (const pt of track) {
		if (pt.lat < minLat) minLat = pt.lat;
		if (pt.lat > maxLat) maxLat = pt.lat;
		if (pt.lng < minLng) minLng = pt.lng;
		if (pt.lng > maxLng) maxLng = pt.lng;
	}
	minLat -= padDeg;
	maxLat += padDeg;
	minLng -= padDeg;
	maxLng += padDeg;

	// Pre-compute cumulative track distance for the `atTrackKm` field.
	const cumKm: number[] = new Array(track.length).fill(0);
	for (let i = 1; i < track.length; i++) {
		cumKm[i] = cumKm[i - 1] + haversineDistanceM(track[i - 1].lat, track[i - 1].lng, track[i].lat, track[i].lng) / 1000;
	}

	// Spatial index: bucket each track point index by its grid cell. Building
	// the grid is O(N) once; each per-POI lookup then scans only the 9 cells
	// around the POI rather than the full track.
	const grid = new Map<string, number[]>();
	const cellKey = (latIdx: number, lngIdx: number): string => `${latIdx},${lngIdx}`;
	for (let i = 0; i < track.length; i++) {
		const latIdx = Math.floor(track[i].lat / GRID_CELL_DEG);
		const lngIdx = Math.floor(track[i].lng / GRID_CELL_DEG);
		const key = cellKey(latIdx, lngIdx);
		const arr = grid.get(key);
		if (arr) arr.push(i);
		else grid.set(key, [i]);
	}

	const hits: PoiProximityHit[] = [];
	for (const poi of pois) {
		if (poi.lat < minLat || poi.lat > maxLat || poi.lng < minLng || poi.lng > maxLng) continue;
		const poiLatIdx = Math.floor(poi.lat / GRID_CELL_DEG);
		const poiLngIdx = Math.floor(poi.lng / GRID_CELL_DEG);
		let minD = Infinity;
		let atIdx = 0;
		for (let dLat = -1; dLat <= 1; dLat++) {
			for (let dLng = -1; dLng <= 1; dLng++) {
				const cell = grid.get(cellKey(poiLatIdx + dLat, poiLngIdx + dLng));
				if (!cell) continue;
				for (const i of cell) {
					const d = haversineDistanceM(poi.lat, poi.lng, track[i].lat, track[i].lng);
					if (d < minD) {
						minD = d;
						atIdx = i;
						if (minD === 0) break;
					}
				}
				if (minD === 0) break;
			}
			if (minD === 0) break;
		}
		if (minD <= radiusM) {
			hits.push({ poi, minDistanceM: minD, atTrackKm: cumKm[atIdx] });
		}
	}
	hits.sort((a, b) => a.atTrackKm - b.atTrackKm);
	return hits;
}
