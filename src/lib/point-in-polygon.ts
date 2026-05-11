import type * as GeoJSON from 'geojson';

/**
 * Ray-casting even-odd algorithm for a single ring (array of [lng, lat] positions).
 */
function pointInRing(lng: number, lat: number, ring: GeoJSON.Position[]): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const xi = ring[i][0];
		const yi = ring[i][1];
		const xj = ring[j][0];
		const yj = ring[j][1];
		if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

/**
 * Tests whether a point lies inside a Polygon or MultiPolygon geometry.
 *
 * @param point - [lng, lat] in GeoJSON coordinate order
 * @param geometry - GeoJSON Polygon or MultiPolygon
 */
export function pointInPolygon(point: [number, number], geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
	const [lng, lat] = point;

	if (geometry.type === 'Polygon') {
		// First ring is the outer boundary; subsequent rings are holes
		if (!pointInRing(lng, lat, geometry.coordinates[0])) return false;
		for (let h = 1; h < geometry.coordinates.length; h++) {
			if (pointInRing(lng, lat, geometry.coordinates[h])) return false;
		}
		return true;
	}

	if (geometry.type === 'MultiPolygon') {
		for (const polygon of geometry.coordinates) {
			if (!pointInRing(lng, lat, polygon[0])) continue;
			let inHole = false;
			for (let h = 1; h < polygon.length; h++) {
				if (pointInRing(lng, lat, polygon[h])) {
					inHole = true;
					break;
				}
			}
			if (!inHole) return true;
		}
	}

	return false;
}
