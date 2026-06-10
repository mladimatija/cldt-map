import localforage from 'localforage';
import type { ParsedTrack } from './gpx-parser';
import type { ImportedTrack, TrackStats } from './store/types';
import { haversineDistanceM as haversineM } from './haversine';
import { buildSpatialGrid } from './spatial-grid';

const MAX_GPX_SIZE = 10_000_000; // 10 MB

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

export async function saveImportedTrack(
	rawXml: string,
	parsed: ParsedTrack,
	existingColorCount: number,
): Promise<ImportedTrack> {
	if (rawXml.length > MAX_GPX_SIZE) {
		throw new Error(`GPX file exceeds maximum allowed size of ${MAX_GPX_SIZE / 1_000_000} MB`);
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
		points: parsed.points,
		importedAt: Date.now(),
		color: TRACK_COLOR_PALETTE[existingColorCount % TRACK_COLOR_PALETTE.length],
	};
	await importedTracksStore.setItem(id, track);
	return track;
}

export async function loadImportedTracks(): Promise<ImportedTrack[]> {
	const keys = await importedTracksStore.keys();
	const results = await Promise.all(keys.map((k) => importedTracksStore.getItem<unknown>(k)));
	return results.filter(isValidImportedTrack).sort((a, b) => a.importedAt - b.importedAt);
}

export async function removeImportedTrack(id: string): Promise<void> {
	await importedTracksStore.removeItem(id);
}

export function computeTrackStats(track: ImportedTrack, enhancedPoints: { lat: number; lng: number }[]): TrackStats {
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

	// Exact nearest-trail-point lookups via a spatial grid (built once per call,
	// O(trail) build + ~O(1) per track point). Replaces the previous hint-based
	// monotone scan, which assumed the track follows the trail in one direction:
	// out-and-back hikes or tracks recorded against the SOBO point order could
	// degrade to a full scan per point and its early-break heuristic could
	// settle on a local minimum across switchbacks, overstating deviation.
	let maxDeviationM = 0;
	let coveragePercent = 0;

	if (enhancedPoints.length > 0) {
		const grid = buildSpatialGrid(enhancedPoints);
		const coverage = new Uint8Array(enhancedPoints.length);
		let covered = 0;

		for (const pt of trackPoints) {
			const hit = grid.nearest(pt.lat, pt.lng);
			if (!hit) continue;
			if (hit.distanceM > maxDeviationM) maxDeviationM = hit.distanceM;
			if (hit.distanceM <= 25 && coverage[hit.index] === 0) {
				coverage[hit.index] = 1;
				covered++;
			}
		}

		coveragePercent = (covered / enhancedPoints.length) * 100;
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
