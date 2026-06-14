import localforage from 'localforage';
import { parseGpx, type ParsedTrack } from './gpx-parser';
import type { ImportedTrack, TrackStats } from './store/types';
import { haversineDistanceM as haversineM } from './haversine';
import { buildSpatialGrid, type SpatialGrid } from './spatial-grid';

const MAX_GPX_SIZE = 50_000_000; // 50 MB

const importedTracksStore = localforage.createInstance({
	name: 'cldt-map',
	storeName: 'imported-tracks',
});

export const TRACK_COLOR_PALETTE = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];

// FNV-1a 32-bit: sufficient for content-addressable deduplication of user-local files
function fnv1aHash(str: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = (h * 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, '0');
}

function isValidImportedTrack(value: unknown): value is ImportedTrack {
	if (!value || typeof value !== 'object') return false;
	const t = value as Record<string, unknown>;
	return (
		typeof t.id === 'string' &&
		t.id.length > 0 &&
		typeof t.name === 'string' &&
		Array.isArray(t.points) &&
		typeof t.importedAt === 'number' &&
		isFinite(t.importedAt) &&
		typeof t.color === 'string'
	);
}

/** Douglas-Peucker tolerance for imported tracks, meters. GPS recorders emit
 *  a point every 1-5 m; 5 m keeps the visual shape and every stat the app
 *  derives (completion uses a 150 m gate, coverage a 25 m gate) while cutting
 *  a recorded multi-day hike by 80-95% - the difference between a panel that
 *  opens instantly and one that locks the main thread for seconds. */
const SIMPLIFY_TOLERANCE_M = 5;

/** Iterative Douglas-Peucker on track points (equirectangular meters).
 *  Keeps the original point objects, so timestamps and elevation survive
 *  for the moving-time stats. Endpoints always survive. */
export function simplifyTrackPoints<T extends { lat: number; lng: number }>(points: T[], toleranceM: number): T[] {
	if (points.length <= 2) return points;
	const cosLat = Math.cos((points[0].lat * Math.PI) / 180);
	const M_PER_DEG = 111_320;
	const x = (p: T): number => p.lng * cosLat * M_PER_DEG;
	const y = (p: T): number => p.lat * M_PER_DEG;
	const keep = new Uint8Array(points.length);
	keep[0] = 1;
	keep[points.length - 1] = 1;
	const stack: [number, number][] = [[0, points.length - 1]];
	while (stack.length > 0) {
		const [lo, hi] = stack.pop() as [number, number];
		if (hi - lo < 2) continue;
		const ax = x(points[lo]);
		const ay = y(points[lo]);
		const bx = x(points[hi]);
		const by = y(points[hi]);
		const dx = bx - ax;
		const dy = by - ay;
		const len2 = dx * dx + dy * dy;
		let maxD2 = -1;
		let maxIdx = -1;
		for (let i = lo + 1; i < hi; i++) {
			const px = x(points[i]) - ax;
			const py = y(points[i]) - ay;
			let d2: number;
			if (len2 === 0) {
				d2 = px * px + py * py;
			} else {
				const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
				const ex = px - t * dx;
				const ey = py - t * dy;
				d2 = ex * ex + ey * ey;
			}
			if (d2 > maxD2) {
				maxD2 = d2;
				maxIdx = i;
			}
		}
		if (maxD2 > toleranceM * toleranceM) {
			keep[maxIdx] = 1;
			stack.push([lo, maxIdx], [maxIdx, hi]);
		}
	}
	const out: T[] = [];
	for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
	return out;
}

export async function saveImportedTrack(
	rawXml: string,
	parsed: ParsedTrack,
	existingColorCount: number,
): Promise<ImportedTrack> {
	if (rawXml.length > MAX_GPX_SIZE) {
		// 'too large' is matched by the dropzone's error mapping.
		throw new Error(`GPX file too large: exceeds maximum of ${MAX_GPX_SIZE / 1_000_000} MB`);
	}

	const id = fnv1aHash(rawXml);
	const existing = await importedTracksStore.getItem<ImportedTrack>(id);
	if (existing) return existing;

	const track: ImportedTrack = {
		id,
		name: (parsed.name ?? 'Imported Track')
			.trim()
			.replace(/<[^>]*>/g, '')
			.slice(0, 255)
			.replace(/[\x00-\x1F]/g, ''),
		points: simplifyTrackPoints(parsed.points, SIMPLIFY_TOLERANCE_M),
		importedAt: Date.now(),
		color: TRACK_COLOR_PALETTE[existingColorCount % TRACK_COLOR_PALETTE.length],
		visible: true,
	};
	await importedTracksStore.setItem(id, track);
	return track;
}

export type ImportGpxXmlResult =
	| { status: 'ok'; track: ImportedTrack; isNew: boolean }
	| { status: 'empty' }
	| { status: 'tooLarge' }
	| { status: 'error' };

/** Parse GPX XML and persist the first track. Dedupes by content hash. */
export async function importGpxXmlAsTrack(
	xml: string,
	existingTracks: readonly ImportedTrack[],
): Promise<ImportGpxXmlResult> {
	try {
		const parsed = parseGpx(xml);
		const firstTrack = parsed.tracks[0];
		if (!firstTrack || firstTrack.points.length === 0) {
			return { status: 'empty' };
		}
		const track = await saveImportedTrack(xml, firstTrack, existingTracks.length);
		const isNew = !existingTracks.some((existing) => existing.id === track.id);
		return { status: 'ok', track, isNew };
	} catch (err) {
		const msg = err instanceof Error ? err.message : '';
		if (msg.includes('large')) return { status: 'tooLarge' };
		return { status: 'error' };
	}
}

/** Read a GPX file and import its first track. */
export async function importGpxFileAsTrack(
	file: File,
	existingTracks: readonly ImportedTrack[],
): Promise<ImportGpxXmlResult> {
	const xml = await file.text();
	return importGpxXmlAsTrack(xml, existingTracks);
}

export async function loadImportedTracks(): Promise<ImportedTrack[]> {
	const keys = await importedTracksStore.keys();
	const results = await Promise.all(keys.map((k) => importedTracksStore.getItem<unknown>(k)));
	return results.filter(isValidImportedTrack).sort((a, b) => a.importedAt - b.importedAt);
}

export async function removeImportedTrack(id: string): Promise<void> {
	await importedTracksStore.removeItem(id);
}

/** Persists user-adjustable fields (color, visibility) for a stored track. */
export async function persistImportedTrackPatch(
	id: string,
	patch: Partial<Pick<ImportedTrack, 'color' | 'visible'>>,
): Promise<void> {
	const existing = await importedTracksStore.getItem<ImportedTrack>(id);
	if (!existing) return;
	await importedTracksStore.setItem(id, { ...existing, ...patch });
}

/** Stats memo, keyed by content-hash id + trail size. Track points are
 *  immutable after import (the id IS the content hash), so entries never go
 *  stale; the trail-size component invalidates if a different GPX loads. */
const statsCache = new Map<string, TrackStats>();

export function computeTrackStats(
	track: ImportedTrack,
	enhancedPoints: { lat: number; lng: number }[],
	sharedGrid?: SpatialGrid,
): TrackStats {
	const cacheKey = `${track.id}:${enhancedPoints.length}`;
	const cached = statsCache.get(cacheKey);
	if (cached) return cached;
	const stats = computeTrackStatsUncached(track, enhancedPoints, sharedGrid);
	statsCache.set(cacheKey, stats);
	return stats;
}

function computeTrackStatsUncached(
	track: ImportedTrack,
	enhancedPoints: { lat: number; lng: number }[],
	sharedGrid?: SpatialGrid,
): TrackStats {
	if (track.points.length === 0) {
		return {
			totalDistanceM: 0,
			totalElapsedSec: 0,
			totalMovingSec: 0,
			avgMovingPaceSecPerKm: 0,
			maxDeviationM: 0,
			coveragePercent: 0,
		};
	}

	const trackPoints = track.points;

	// Total walked distance
	let totalDistanceM = 0;
	for (let i = 1; i < trackPoints.length; i++) {
		totalDistanceM += haversineM(
			trackPoints[i - 1].lat,
			trackPoints[i - 1].lng,
			trackPoints[i].lat,
			trackPoints[i].lng,
		);
	}

	// Elapsed and moving time
	let totalElapsedSec = 0;
	let totalMovingSec = 0;
	const timedPts = trackPoints.filter((p) => p.time instanceof Date);
	if (timedPts.length >= 2) {
		totalElapsedSec = (timedPts[timedPts.length - 1].time!.getTime() - timedPts[0].time!.getTime()) / 1000;
		for (let i = 1; i < timedPts.length; i++) {
			const deltaMs = timedPts[i].time!.getTime() - timedPts[i - 1].time!.getTime();
			// Skip negative deltas (out-of-order timestamps) and pauses >2 min
			if (deltaMs > 0 && deltaMs <= 120_000) totalMovingSec += deltaMs / 1000;
		}
	}

	const avgMovingPaceSecPerKm = totalDistanceM > 0 && totalMovingSec > 0 ? totalMovingSec / (totalDistanceM / 1000) : 0;

	// Deviation and coverage are computed over the track RESAMPLED every 50 m,
	// not over the stored vertices: import-time simplification keeps few
	// vertices on straight stretches, which would starve both metrics (and
	// "covered" used to mean "% of the whole 2,220 km trail", a number that
	// rounds to 0 for any day hike). Coverage now answers the question a
	// hiker actually asks: what share of MY TRACK followed the official
	// route (within 25 m).
	let maxDeviationM = 0;
	let coveragePercent = 0;

	if (enhancedPoints.length > 0 && trackPoints.length > 0) {
		const grid = sharedGrid ?? buildSpatialGrid(enhancedPoints);
		let samples = 0;
		let onTrailSamples = 0;
		forEachResampledPoint(trackPoints, RESAMPLE_STEP_M, (lat, lng) => {
			const hit = grid.nearest(lat, lng);
			if (!hit) return;
			samples++;
			if (hit.distanceM > maxDeviationM) maxDeviationM = hit.distanceM;
			if (hit.distanceM <= 25) onTrailSamples++;
		});
		if (samples > 0) coveragePercent = (onTrailSamples / samples) * 100;
	}

	return {
		totalDistanceM,
		totalElapsedSec,
		totalMovingSec,
		avgMovingPaceSecPerKm,
		maxDeviationM,
		coveragePercent,
	};
}

/** Track bounding box as [[minLat, minLng], [maxLat, maxLng]], or null for
 *  empty tracks. Single numeric pass - feed straight into map.fitBounds. */
export function trackBounds(track: ImportedTrack): [[number, number], [number, number]] | null {
	if (track.points.length === 0) return null;
	let minLat = Infinity;
	let maxLat = -Infinity;
	let minLng = Infinity;
	let maxLng = -Infinity;
	for (const pt of track.points) {
		if (pt.lat < minLat) minLat = pt.lat;
		if (pt.lat > maxLat) maxLat = pt.lat;
		if (pt.lng < minLng) minLng = pt.lng;
		if (pt.lng > maxLng) maxLng = pt.lng;
	}
	return [
		[minLat, minLng],
		[maxLat, maxLng],
	];
}

/** Step used whenever a metric walks the track geometry. Import-time
 *  simplification keeps only shape vertices, so straight stretches carry
 *  almost no points - every gate (coverage 25 m, completion 50 m) must
 *  measure interpolated samples, never the sparse vertices. */
const RESAMPLE_STEP_M = 50;

/** Invokes cb for the first point and then every `stepM` meters along the
 *  track, interpolating linearly inside segments. */
export function forEachResampledPoint(
	points: readonly { lat: number; lng: number }[],
	stepM: number,
	cb: (lat: number, lng: number) => void,
): void {
	if (points.length === 0) return;
	cb(points[0].lat, points[0].lng);
	let carryM = 0;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const segM = haversineM(a.lat, a.lng, b.lat, b.lng);
		if (segM === 0) continue;
		let along = stepM - carryM;
		while (along <= segM) {
			const f = along / segM;
			cb(a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f);
			along += stepM;
		}
		carryM = (carryM + segM) % stepM;
	}
}

/** Trail km positions (SOBO) where the RESAMPLED track runs within
 *  `maxOffTrailM` of the trail. Feed into intervalsFromKms for completion
 *  import; resampling is what lets a simplified track with two vertices on
 *  a 5 km on-trail straight still register the whole stretch. */
export function trackOnTrailKms(
	track: ImportedTrack,
	enhancedPoints: readonly { lat: number; lng: number; distanceFromStart: number }[],
	maxOffTrailM: number,
	sharedGrid?: SpatialGrid,
): number[] {
	if (enhancedPoints.length === 0 || track.points.length === 0) return [];
	const grid = sharedGrid ?? buildSpatialGrid(enhancedPoints);
	const kms: number[] = [];
	forEachResampledPoint(track.points, RESAMPLE_STEP_M, (lat, lng) => {
		const hit = grid.nearest(lat, lng);
		if (hit && hit.distanceM <= maxOffTrailM) {
			kms.push(enhancedPoints[hit.index].distanceFromStart / 1000);
		}
	});
	return kms;
}
