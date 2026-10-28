import croatiaBbox from './croatia-bbox.json';

/**
 * Croatia's bounding box (src/lib/croatia-bbox.json): the territorial sea west
 * of Istria to the northernmost corner by the Mura and the eastern edge at
 * Ilok. It covers all of Croatia at the cost of slivers of its neighbours (and,
 * being a box, much of Bosnia): the in-Croatia location checks, the tile
 * precache clip and, through the build stamp, the service worker's cache clip
 * all use it, and the outline polygon refines the tile clips.
 */
export const CROATIA_BBOX: Readonly<{ latMin: number; latMax: number; lngMin: number; lngMax: number }> = croatiaBbox;

export function isInCroatiaBbox(lat: number, lng: number): boolean {
	return (
		lat >= CROATIA_BBOX.latMin && lat <= CROATIA_BBOX.latMax && lng >= CROATIA_BBOX.lngMin && lng <= CROATIA_BBOX.lngMax
	);
}

/** A random point inside the Croatia box, for the dev-mode fake user location. */
export function getRandomLocationInBoundary(): { lat: number; lng: number } {
	const lat = CROATIA_BBOX.latMin + Math.random() * (CROATIA_BBOX.latMax - CROATIA_BBOX.latMin);
	const lng = CROATIA_BBOX.lngMin + Math.random() * (CROATIA_BBOX.lngMax - CROATIA_BBOX.lngMin);
	return { lat, lng };
}

export interface LatLngBox {
	minLat: number;
	maxLat: number;
	minLng: number;
	maxLng: number;
}

/** Bounding box of `points`, or of the index range `from`..`to` (inclusive);
 *  null when the range holds no points. */
export function boundsOf(
	points: ArrayLike<{ lat: number; lng: number }>,
	from = 0,
	to = points.length - 1,
): LatLngBox | null {
	let minLat = Infinity;
	let maxLat = -Infinity;
	let minLng = Infinity;
	let maxLng = -Infinity;
	for (let i = from; i <= to; i++) {
		const p = points[i];
		if (p.lat < minLat) minLat = p.lat;
		if (p.lat > maxLat) maxLat = p.lat;
		if (p.lng < minLng) minLng = p.lng;
		if (p.lng > maxLng) maxLng = p.lng;
	}
	return Number.isFinite(minLat) ? { minLat, maxLat, minLng, maxLng } : null;
}

/** A box as Leaflet's [[south, west], [north, east]] pair, for fitBounds. */
export function toLeafletBounds(box: LatLngBox): [[number, number], [number, number]] {
	return [
		[box.minLat, box.minLng],
		[box.maxLat, box.maxLng],
	];
}
