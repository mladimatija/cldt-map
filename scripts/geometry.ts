/**
 * Geometry helpers shared by the data build scripts (mine areas, warning
 * regions). Coordinates are GeoJSON positions in degrees.
 */
import type * as GeoJSON from 'geojson';

export type Ring = GeoJSON.Position[];

/** Iterative Douglas-Peucker on a ring (closed: first == last). */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
	if (ring.length <= 5) return ring;
	const keep = new Array<boolean>(ring.length).fill(false);
	keep[0] = keep[ring.length - 1] = true;
	const stack: [number, number][] = [[0, ring.length - 1]];
	while (stack.length > 0) {
		const [lo, hi] = stack.pop() as [number, number];
		if (hi - lo < 2) continue;
		const [x1, y1] = ring[lo];
		const [x2, y2] = ring[hi];
		const dx = x2 - x1;
		const dy = y2 - y1;
		const lenSq = dx * dx + dy * dy;
		let maxDist = -1;
		let maxIdx = -1;
		for (let i = lo + 1; i < hi; i++) {
			const [px, py] = ring[i];
			let dist: number;
			if (lenSq === 0) {
				dist = Math.hypot(px - x1, py - y1);
			} else {
				const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
				dist = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
			}
			if (dist > maxDist) {
				maxDist = dist;
				maxIdx = i;
			}
		}
		if (maxDist > tolerance) {
			keep[maxIdx] = true;
			stack.push([lo, maxIdx], [maxIdx, hi]);
		}
	}
	const out = ring.filter((_, i) => keep[i]);
	// A valid ring needs 4 positions (triangle + closure); fall back to the
	// original when simplification collapses it.
	return out.length >= 4 ? out : ring;
}

export function mapRings(
	geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
	mapRing: (ring: Ring) => Ring,
): GeoJSON.Polygon | GeoJSON.MultiPolygon {
	if (geometry.type === 'Polygon') {
		return { type: 'Polygon', coordinates: geometry.coordinates.map(mapRing) };
	}
	return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((poly) => poly.map(mapRing)) };
}

export function round(v: number, places: number): number {
	const f = 10 ** places;
	return Math.round(v * f) / f;
}
