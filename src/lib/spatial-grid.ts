/**
 * Uniform lat/lng grid index for nearest-neighbor queries against a fixed set
 * of points (e.g. the enhanced trail polyline). Build once in O(n), query the
 * exact nearest point in ~O(1) for on-corridor queries via expanding cell
 * rings (worst case degrades gracefully for far-away queries).
 *
 * Distances use the same haversine as the rest of the app, so results are
 * drop-in compatible with linear scans. Cell sizing uses an equirectangular
 * approximation at the dataset's mid-latitude, which is accurate at Croatia's
 * extent and conservative elsewhere (cells merely get slightly rectangular,
 * never incorrect, because the ring-stop bound below uses the smaller of the
 * two cell dimensions).
 */
import { haversineDistanceM } from './haversine';

const METERS_PER_DEGREE_LAT = 111_320;

export interface NearestHit {
	/** Index into the points array passed to buildSpatialGrid. */
	index: number;
	/** Haversine distance from the query to that point, meters. */
	distanceM: number;
}

export interface SpatialGrid {
	nearest(lat: number, lng: number): NearestHit | null;
}

interface GridPoint {
	lat: number;
	lng: number;
}

/**
 * Builds the grid. `cellSizeM` trades memory for ring count; 500 m works well
 * for trail-scale data (a 2200 km trail at ~10 m point spacing lands ~4-5
 * points per cell).
 */
export function buildSpatialGrid(points: readonly GridPoint[], cellSizeM = 500): SpatialGrid {
	if (points.length === 0) {
		return { nearest: () => null };
	}

	let minLat = Infinity;
	let maxLat = -Infinity;
	for (const p of points) {
		if (p.lat < minLat) minLat = p.lat;
		if (p.lat > maxLat) maxLat = p.lat;
	}
	const midLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
	const cellLatDeg = cellSizeM / METERS_PER_DEGREE_LAT;
	// Clamp the cos so polar data cannot produce a degenerate (infinite-width) cell.
	const cellLngDeg = cellSizeM / (METERS_PER_DEGREE_LAT * Math.max(0.05, Math.cos(midLatRad)));
	// Lower bound (meters) on the distance covered by stepping one ring out;
	// used as the safe stopping criterion for the expanding search.
	const minCellSpanM = cellSizeM;

	const cells = new Map<string, number[]>();
	const keyFor = (lat: number, lng: number): string =>
		`${Math.floor(lat / cellLatDeg)}:${Math.floor(lng / cellLngDeg)}`;

	for (let i = 0; i < points.length; i++) {
		const key = keyFor(points[i].lat, points[i].lng);
		const bucket = cells.get(key);
		if (bucket) bucket.push(i);
		else cells.set(key, [i]);
	}

	// Ring scan caps at the grid's own diameter: beyond that every cell has
	// been visited and the query point is simply far from all data.
	const latCells = Math.ceil((maxLat - minLat) / cellLatDeg) + 2;
	let minLng = Infinity;
	let maxLng = -Infinity;
	for (const p of points) {
		if (p.lng < minLng) minLng = p.lng;
		if (p.lng > maxLng) maxLng = p.lng;
	}
	const lngCells = Math.ceil((maxLng - minLng) / cellLngDeg) + 2;
	const maxRing = Math.max(latCells, lngCells);

	function nearest(lat: number, lng: number): NearestHit | null {
		const baseLat = Math.floor(lat / cellLatDeg);
		const baseLng = Math.floor(lng / cellLngDeg);

		let bestIdx = -1;
		let bestDist = Infinity;

		const scanCell = (latKey: number, lngKey: number): void => {
			const bucket = cells.get(`${latKey}:${lngKey}`);
			if (!bucket) return;
			for (const i of bucket) {
				const d = haversineDistanceM(lat, lng, points[i].lat, points[i].lng);
				if (d < bestDist) {
					bestDist = d;
					bestIdx = i;
				}
			}
		};

		for (let ring = 0; ring <= maxRing; ring++) {
			// A point inside ring `ring` is at least (ring - 1) * minCellSpanM away,
			// so once the best hit beats that bound no farther ring can improve it.
			if (bestIdx !== -1 && (ring - 1) * minCellSpanM > bestDist) break;

			if (ring === 0) {
				scanCell(baseLat, baseLng);
				continue;
			}
			// Perimeter of the square ring at Chebyshev distance `ring`.
			for (let dx = -ring; dx <= ring; dx++) {
				scanCell(baseLat - ring, baseLng + dx);
				scanCell(baseLat + ring, baseLng + dx);
			}
			for (let dy = -ring + 1; dy <= ring - 1; dy++) {
				scanCell(baseLat + dy, baseLng - ring);
				scanCell(baseLat + dy, baseLng + ring);
			}
		}

		return bestIdx === -1 ? null : { index: bestIdx, distanceM: bestDist };
	}

	return { nearest };
}
