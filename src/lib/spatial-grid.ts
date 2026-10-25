/**
 * Uniform lat/lng grid index for nearest-neighbor queries against a fixed set
 * of points (e.g. the enhanced trail polyline). Build once in O(n), query the
 * exact nearest point in ~O(1) for on-corridor queries via expanding cell
 * rings (worst case degrades gracefully for far-away queries).
 *
 * Distances use the same haversine as the rest of the app, so results are
 * drop-in compatible with linear scans. Cell sizing uses an equirectangular
 * approximation at the dataset's mid-latitude, so cells are slightly narrower
 * away from it; the ring-stop bound below uses the narrowest cell the search
 * can cross, which keeps the result exact.
 */
import { haversineDistanceM } from './haversine';
import { boundsOf } from './geo-bounds';

const METERS_PER_DEGREE_LAT = 111_320;
/** Cell indices are shifted by the offset and packed into one number; with
 *  cells of 50 m or more every index on Earth fits, well inside the safe
 *  integer range. */
const CELL_KEY_OFFSET = 2 ** 20;
const CELL_KEY_STRIDE = 2 ** 21;

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

	const box = boundsOf(points);
	// No point with usable coordinates (a malformed track): nothing to find.
	if (!box) {
		return { nearest: () => null };
	}
	const { minLat, maxLat, minLng, maxLng } = box;
	const midLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
	const cellLatDeg = cellSizeM / METERS_PER_DEGREE_LAT;
	// Clamp the cos so polar data cannot produce a degenerate (infinite-width) cell.
	const cellLngDeg = cellSizeM / (METERS_PER_DEGREE_LAT * Math.max(0.05, Math.cos(midLatRad)));
	/** East-west width of a cell at a latitude, in meters. */
	const cellWidthAtM = (lat: number): number => cellLngDeg * METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
	// Narrowest cell over the data: the latitude farthest from the equator.
	const dataMinSpanM = Math.min(cellSizeM, cellWidthAtM(Math.max(Math.abs(minLat), Math.abs(maxLat))));

	// Numeric cell keys: string building in the per-query ring loop was the hot spot.
	const cells = new Map<number, number[]>();
	const cellKey = (latCell: number, lngCell: number): number =>
		(latCell + CELL_KEY_OFFSET) * CELL_KEY_STRIDE + (lngCell + CELL_KEY_OFFSET);
	const keyFor = (lat: number, lng: number): number =>
		cellKey(Math.floor(lat / cellLatDeg), Math.floor(lng / cellLngDeg));

	for (let i = 0; i < points.length; i++) {
		const key = keyFor(points[i].lat, points[i].lng);
		const bucket = cells.get(key);
		if (bucket) bucket.push(i);
		else cells.set(key, [i]);
	}

	// Ring scan caps at the grid's own diameter: beyond that every cell has
	// been visited and the query point is simply far from all data.
	const latCells = Math.ceil((maxLat - minLat) / cellLatDeg) + 2;
	const lngCells = Math.ceil((maxLng - minLng) / cellLngDeg) + 2;
	const maxRing = Math.max(latCells, lngCells);

	function nearest(lat: number, lng: number): NearestHit | null {
		const baseLat = Math.floor(lat / cellLatDeg);
		const baseLng = Math.floor(lng / cellLngDeg);
		// Lower bound (meters) on the distance covered by stepping one ring out: the
		// narrowest cell between the query and the data. The safe stopping criterion.
		const minCellSpanM = Math.min(dataMinSpanM, cellWidthAtM(Math.abs(lat)));

		let bestIdx = -1;
		let bestDist = Infinity;

		const scanCell = (latKey: number, lngKey: number): void => {
			const bucket = cells.get(cellKey(latKey, lngKey));
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
