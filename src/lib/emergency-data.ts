export interface RoadAccessEntry {
	lat: number;
	lng: number;
	trailKm: number;
	roadRef: string;
}

export interface HgssStation {
	name: string;
	lat: number;
	lng: number;

	phone?: string;
	url?: string;
}

const isFiniteLatLng = <T extends { lat: number; lng: number }>(e: T): boolean =>
	Number.isFinite(e.lat) && Number.isFinite(e.lng);

let roadAccessCache: RoadAccessEntry[] | null = null;
let hgssStationsCache: HgssStation[] | null = null;
let inflight: Promise<{ roadAccess: RoadAccessEntry[]; hgssStations: HgssStation[] }> | null = null;
// After a confirmed fetch failure, fall through to empty caches rather than retrying
// on every panel open. The SW pre-caches /data/* at install, so a failure here means
// the user is on a fresh install while offline.
let loadFailed = false;

export async function loadEmergencyData(): Promise<{ roadAccess: RoadAccessEntry[]; hgssStations: HgssStation[] }> {
	if (roadAccessCache !== null && hgssStationsCache !== null) {
		return { roadAccess: roadAccessCache, hgssStations: hgssStationsCache };
	}
	if (loadFailed) return { roadAccess: [], hgssStations: [] };
	if (inflight === null) {
		inflight = (async () => {
			const [roadResp, hgssResp] = await Promise.all([
				fetch('/data/road-access.json', { cache: 'force-cache' }),
				fetch('/data/hgss-stations.json', { cache: 'force-cache' }),
			]);
			if (!roadResp.ok || !hgssResp.ok) throw new Error('Failed to load emergency data');
			const [road, hgss] = await Promise.all([
				roadResp.json() as Promise<RoadAccessEntry[]>,
				hgssResp.json() as Promise<HgssStation[]>,
			]);
			roadAccessCache = road.filter(isFiniteLatLng);
			hgssStationsCache = hgss.filter(isFiniteLatLng);
			return { roadAccess: roadAccessCache, hgssStations: hgssStationsCache };
		})()
			.catch((err) => {
				loadFailed = true;
				throw err;
			})
			.finally(() => {
				inflight = null;
			});
	}
	return inflight;
}

// Warm both caches (module + service worker) so the panel opens instantly offline.
export function prefetchEmergencyData(): Promise<void> {
	return loadEmergencyData().then(
		() => undefined,
		() => undefined,
	);
}

/** Haversine distance between two lat/lng pairs in metres. */
export function haversineDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371000;
	const toRad = (deg: number): number => (deg * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type CompassDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/** 8-way compass quadrant for a bearing in degrees (0-360). */
export function bearingToCompass(bearing: number): CompassDirection {
	const normalised = ((bearing % 360) + 360) % 360;
	const sectors: CompassDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
	const index = Math.round(normalised / 45) % 8;
	return sectors[index];
}

export interface NearestEmergencyEntry<T> {
	entry: T;
	distanceM: number;
	bearingDeg: number;
}

/**
 * Finds the nearest entry in `entries` to `(lat, lng)`. Returns null when
 * the list is empty.
 */
export function findNearestEntry<T extends { lat: number; lng: number }>(
	entries: T[],
	lat: number,
	lng: number,
	bearingFn: (lat1: number, lng1: number, lat2: number, lng2: number) => number,
): NearestEmergencyEntry<T> | null {
	if (entries.length === 0) return null;
	let bestIndex = 0;
	let bestDistance = haversineDistanceM(lat, lng, entries[0].lat, entries[0].lng);
	for (let i = 1; i < entries.length; i++) {
		const d = haversineDistanceM(lat, lng, entries[i].lat, entries[i].lng);
		if (d < bestDistance) {
			bestDistance = d;
			bestIndex = i;
		}
	}
	const best = entries[bestIndex];
	return {
		entry: best,
		distanceM: bestDistance,
		bearingDeg: bearingFn(lat, lng, best.lat, best.lng),
	};
}
