/**
 * Great-circle distance via the haversine formula. Returns metres.
 *
 * Two call styles are supported via overloads so callers with loose lat/lng
 * numbers (hot inner loops, API handlers) and callers with {lat, lng} objects
 * (script pipelines, point arrays) can share one implementation:
 *
 *   haversineDistanceM(lat1, lng1, lat2, lng2)
 *   haversineDistanceM({ lat, lng }, { lat, lng })
 *
 * For kilometres, divide by 1000 at the callsite.
 */
export interface LatLng {
	lat: number;
	lng: number;
}

const EARTH_RADIUS_M = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;

function haversineRaw(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const dLat = (lat2 - lat1) * DEG_TO_RAD;
	const dLng = (lng2 - lng1) * DEG_TO_RAD;
	const a =
		Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function haversineDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number;
export function haversineDistanceM(a: LatLng, b: LatLng): number;
export function haversineDistanceM(
	aOrLat1: LatLng | number,
	bOrLng1: LatLng | number,
	lat2?: number,
	lng2?: number,
): number {
	if (typeof aOrLat1 === 'number') {
		return haversineRaw(aOrLat1, bOrLng1 as number, lat2 as number, lng2 as number);
	}
	const a = aOrLat1;
	const b = bOrLng1 as LatLng;
	return haversineRaw(a.lat, a.lng, b.lat, b.lng);
}
