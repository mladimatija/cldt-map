/**
 * Pure helpers for journal entries linked to imported GPX track segments.
 * Official trail km is always SOBO; display mirrors via displayTrailKm.
 */
import type { TrackPoint } from './gpx-parser';
import { IMPORT_MAX_OFF_TRAIL_M } from './completion';
import { findNearestPointIndex } from './distance-utils';
import { forEachResampledPoint, trackBounds } from './imported-tracks';
import { buildSpatialGrid, type SpatialGrid } from './spatial-grid';
import type { ImportedTrack, JournalPreview } from './store/types';
import type { JournalEntry, JournalTrackLink } from './user-waypoints';

export type ResolveTrackLinkResult =
	| { status: 'none' }
	| { status: 'missing'; link: JournalTrackLink }
	| { status: 'ok'; link: JournalTrackLink; track: ImportedTrack };

/** Mirror SOBO storage km for NOBO display labels. */
export function displayTrailKm(soboKm: number, direction: 'SOBO' | 'NOBO', totalKm: number): number {
	return direction === 'SOBO' ? soboKm : Math.max(0, totalKm - soboKm);
}

export function validateTrackLink(link: JournalTrackLink, track: ImportedTrack): JournalTrackLink {
	const maxIdx = Math.max(0, track.points.length - 1);
	const startIdx = Math.max(0, Math.min(link.startIdx, maxIdx));
	const endIdx = Math.max(startIdx, Math.min(link.endIdx, maxIdx));
	return {
		trackId: link.trackId,
		startIdx,
		endIdx,
		trackName: link.trackName || track.name,
	};
}

export function sliceTrackPoints(track: ImportedTrack, link: JournalTrackLink): TrackPoint[] {
	const valid = validateTrackLink(link, track);
	return track.points.slice(valid.startIdx, valid.endIdx + 1);
}

export function resolveTrackLink(
	entry: JournalEntry,
	importedTracks: readonly ImportedTrack[],
): ResolveTrackLinkResult {
	if (!entry.trackLink) return { status: 'none' };
	const track = importedTracks.find((t) => t.id === entry.trackLink!.trackId);
	if (!track) return { status: 'missing', link: entry.trackLink };
	return { status: 'ok', link: entry.trackLink, track };
}

/** Bounding envelope of on-trail SOBO km for a track point index range. */
export function computeOnTrailRangeForIndices(
	track: ImportedTrack,
	startIdx: number,
	endIdx: number,
	enhancedPoints: readonly { lat: number; lng: number; distanceFromStart: number }[],
	sharedGrid?: SpatialGrid,
): { startKm: number; endKm: number } | null {
	if (track.points.length === 0 || enhancedPoints.length === 0) return null;
	const lo = Math.max(0, Math.min(startIdx, track.points.length - 1));
	const hi = Math.max(lo, Math.min(endIdx, track.points.length - 1));
	const segment = track.points.slice(lo, hi + 1);
	if (segment.length === 0) return null;

	const grid = sharedGrid ?? buildSpatialGrid(enhancedPoints);
	const kms: number[] = [];
	forEachResampledPoint(segment, 50, (lat, lng) => {
		const hit = grid.nearest(lat, lng);
		if (hit && hit.distanceM <= IMPORT_MAX_OFF_TRAIL_M) {
			kms.push(enhancedPoints[hit.index].distanceFromStart / 1000);
		}
	});
	if (kms.length === 0) return null;
	return { startKm: Math.min(...kms), endKm: Math.max(...kms) };
}

/** Inclusive track point indices whose snapped SOBO km falls in [loKm, hiKm]. */
export function computeIndicesForTrailRange(
	track: ImportedTrack,
	loKm: number,
	hiKm: number,
	enhancedPoints: readonly { lat: number; lng: number; distanceFromStart: number }[],
	sharedGrid?: SpatialGrid,
): { startIdx: number; endIdx: number } | null {
	if (track.points.length === 0 || enhancedPoints.length === 0) return null;
	const lo = Math.min(loKm, hiKm);
	const hi = Math.max(loKm, hiKm);
	const grid = sharedGrid ?? buildSpatialGrid(enhancedPoints);
	let minIdx = -1;
	let maxIdx = -1;
	for (let i = 0; i < track.points.length; i++) {
		const pt = track.points[i];
		const hit = grid.nearest(pt.lat, pt.lng);
		if (!hit || hit.distanceM > IMPORT_MAX_OFF_TRAIL_M) continue;
		const km = enhancedPoints[hit.index].distanceFromStart / 1000;
		if (km >= lo && km <= hi) {
			if (minIdx < 0) minIdx = i;
			maxIdx = i;
		}
	}
	if (minIdx < 0 || maxIdx < 0) return null;
	return { startIdx: minIdx, endIdx: maxIdx };
}

export interface RecordedStats {
	distanceM: number;
	elapsedSec: number;
	movingSec: number;
}

/** Walked distance and optional elapsed/moving time for a track slice. */
export function formatRecordedStats(points: readonly TrackPoint[]): RecordedStats {
	if (points.length === 0) {
		return { distanceM: 0, elapsedSec: 0, movingSec: 0 };
	}
	let distanceM = 0;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const dLat = ((b.lat - a.lat) * Math.PI) / 180;
		const dLng = ((b.lng - a.lng) * Math.PI) / 180;
		const x = dLng * Math.cos((a.lat * Math.PI) / 180);
		const y = dLat;
		distanceM += Math.sqrt(x * x + y * y) * 111_320;
	}

	const timed = points.filter((p) => p.time instanceof Date);
	let elapsedSec = 0;
	let movingSec = 0;
	if (timed.length >= 2) {
		elapsedSec = (timed[timed.length - 1].time!.getTime() - timed[0].time!.getTime()) / 1000;
		for (let i = 1; i < timed.length; i++) {
			const deltaMs = timed[i].time!.getTime() - timed[i - 1].time!.getTime();
			if (deltaMs > 0 && deltaMs <= 120_000) movingSec += deltaMs / 1000;
		}
	}
	return { distanceM, elapsedSec, movingSec };
}

/** Lat/lng bounds for map.fitBounds: track segment when linked, else trail interval. */
export function journalEntryBoundsForFit(
	entry: JournalEntry,
	track: ImportedTrack | null,
	enhancedPoints: readonly { lat: number; lng: number; distanceFromStart: number }[],
): [[number, number], [number, number]] | null {
	if (entry.trackLink && track) {
		return trackBounds({ ...track, points: sliceTrackPoints(track, entry.trackLink) });
	}
	if (entry.startKm !== undefined && entry.endKm !== undefined && enhancedPoints.length >= 2) {
		const loM = Math.min(entry.startKm, entry.endKm) * 1000;
		const hiM = Math.max(entry.startKm, entry.endKm) * 1000;
		const startIdx = findNearestPointIndex([...enhancedPoints], loM);
		const endIdx = findNearestPointIndex([...enhancedPoints], hiM);
		const lo = Math.min(startIdx, endIdx);
		const hi = Math.max(startIdx, endIdx);
		let minLat = Infinity;
		let maxLat = -Infinity;
		let minLng = Infinity;
		let maxLng = -Infinity;
		for (let i = lo; i <= hi; i++) {
			const p = enhancedPoints[i];
			if (p.lat < minLat) minLat = p.lat;
			if (p.lat > maxLat) maxLat = p.lat;
			if (p.lng < minLng) minLng = p.lng;
			if (p.lng > maxLng) maxLng = p.lng;
		}
		if (!Number.isFinite(minLat)) return null;
		return [
			[minLat, minLng],
			[maxLat, maxLng],
		];
	}
	return null;
}

/** Enforce journal invariants when writing trackLink + trail km together. */
export function buildJournalTrackAttachment(
	track: ImportedTrack,
	startIdx: number,
	endIdx: number,
	enhancedPoints: readonly { lat: number; lng: number; distanceFromStart: number }[],
	sharedGrid?: SpatialGrid,
): { trackLink: JournalTrackLink; startKm?: number; endKm?: number } {
	const range = computeOnTrailRangeForIndices(track, startIdx, endIdx, enhancedPoints, sharedGrid);
	const link: JournalTrackLink = {
		trackId: track.id,
		startIdx,
		endIdx,
		trackName: track.name,
	};
	const valid = validateTrackLink(link, track);
	if (!range) {
		return { trackLink: valid };
	}
	return { trackLink: valid, startKm: range.startKm, endKm: range.endKm };
}

/**
 * Builds the map-overlay preview for a journal entry's current attach state, or
 * null when there is nothing to show. Pass the CURRENT `attachRuler` value
 * (not a stale closure), so toggling the ruler attachment off clears the preview.
 */
export function buildJournalPreview(
	state: { trackLink: JournalTrackLink | null; startKm?: number; endKm?: number },
	attachRuler: boolean,
	rulerKms: { lo: number; hi: number } | null | undefined,
	importedTracks: ImportedTrack[],
	entryId: string | null,
): JournalPreview | null {
	let trailStartKm = state.startKm;
	let trailEndKm = state.endKm;
	if (attachRuler && rulerKms && !state.trackLink) {
		trailStartKm = rulerKms.lo;
		trailEndKm = rulerKms.hi;
	}
	if (trailStartKm === undefined || trailEndKm === undefined) return null;
	const track = state.trackLink ? importedTracks.find((tr) => tr.id === state.trackLink!.trackId) : null;
	return {
		entryId,
		trailStartKm,
		trailEndKm,
		...(state.trackLink && track
			? {
					trackId: state.trackLink.trackId,
					startIdx: state.trackLink.startIdx,
					endIdx: state.trackLink.endIdx,
					trackColor: track.color,
				}
			: {}),
	};
}
