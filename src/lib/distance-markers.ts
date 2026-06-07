import type { EnhancedTrailPoint } from '@/lib/store';
import type { UnitSystem } from '@/lib/types';

/** Step sizes (in the active unit: km or mi) at which markers are emitted. */
export const DISTANCE_MARKER_LEVELS = [100, 50, 25, 10, 5, 1] as const;

export type DistanceMarkerLevel = (typeof DISTANCE_MARKER_LEVELS)[number];

export interface DistanceMarker {
	lat: number;
	lng: number;
	/** Distance from current direction's start, in metres. */
	distanceM: number;
	/** Density class for styling and zoom-visibility (1, 5, 10, 25, 50, 100). Not the printed label. */
	level: DistanceMarkerLevel;
	/** Cumulative distance from the active start, expressed as a whole number in the active unit (km or mi).
	 * E.g., the 200 km marker has label "200", the 175 km marker has the label "175".
	 * */
	label: string;
}

const METRES_PER_MILE = 1609.344;

/**
 * Computes one DistanceMarker per (level, milestone) along the trail.
 * Each milestone (e.g., 100 km, 5 mi) is snapped to the nearest GPX point
 * so the marker sits exactly on the polyline rather than between vertices.
 *
 * A single milestone is emitted at its LARGEST matching level only - i.e.,
 * the km-100 point gets a level-100 marker, NOT also a level-50 / 25 / 10 /
 * 5 / 1 marker. The visibility logic in `TrailDistanceMarkers` then decides
 * which levels are shown at the current zoom, and a level-100 marker stays
 * visible at every zoom that level-50 would also be (since it's the same
 * physical point). This keeps the marker count to one per milestone.
 *
 * Direction-agnostic: consumes `distanceFromStart` which is already adjusted
 * for SOBO / NOBO upstream. Re-runs naturally when the trail rebuilds.
 */
export function computeDistanceMarkers(points: EnhancedTrailPoint[], units: UnitSystem): DistanceMarker[] {
	if (!points || points.length < 2) return [];

	const stepM = units === 'imperial' ? METRES_PER_MILE : 1000;
	const totalM = points[points.length - 1].distanceFromStart;

	const markers: DistanceMarker[] = [];
	const emittedAtM = new Set<number>();

	for (const level of DISTANCE_MARKER_LEVELS) {
		const intervalM = level * stepM;
		// Skip milestoneM = 0; a separate start flag already marks km 0.
		for (let milestoneM = intervalM, n = level; milestoneM < totalM; milestoneM += intervalM, n += level) {
			const rounded = Math.round(milestoneM);
			if (emittedAtM.has(rounded)) continue;
			const idx = nearestPointIndex(points, milestoneM);
			const p = points[idx];
			markers.push({
				lat: p.lat,
				lng: p.lng,
				distanceM: p.distanceFromStart,
				level,
				label: String(n),
			});
			emittedAtM.add(rounded);
		}
	}

	// Stable order by distance so consumers can binary-search by km if needed.
	markers.sort((a, b) => a.distanceM - b.distanceM);
	return markers;
}

function nearestPointIndex(points: EnhancedTrailPoint[], targetM: number): number {
	// Binary-search the sorted distanceFromStart array.
	let lo = 0;
	let hi = points.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (points[mid].distanceFromStart < targetM) lo = mid + 1;
		else hi = mid;
	}
	if (
		lo > 0 &&
		Math.abs(points[lo - 1].distanceFromStart - targetM) < Math.abs(points[lo].distanceFromStart - targetM)
	) {
		return lo - 1;
	}
	return lo;
}

/**
 * Map of marker level -> Leaflet zoom levels at which the marker should be
 * visible. 100 km always visible, lower levels only as the user zooms in.
 * The level-25 entry is intentionally split (visible at low zoom for a gentle
 * density bump, hidden at zoom 10 when level-10 markers take over, then
 * visible again at zoom 11+).
 */
export function isLevelVisibleAtZoom(level: DistanceMarkerLevel, zoom: number): boolean {
	switch (level) {
		case 100:
			return true;
		case 50:
			return zoom >= 7;
		case 25:
			return (zoom >= 8 && zoom <= 9) || zoom >= 11;
		case 10:
			return zoom >= 10;
		case 5:
			return zoom >= 11;
		case 1:
			return zoom >= 13;
	}
}
