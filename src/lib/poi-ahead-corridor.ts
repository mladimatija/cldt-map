/**
 * Forward corridor filter for "POIs along the next N km".
 * Anchor is GPS on-trail when available, otherwise the ruler range midpoint.
 */
import type { ClosestPoint, TrailDirection, UnitSystem } from '@/lib/store/types';
import type { RulerRange } from '@/lib/distance-utils';
import { isKnownType, poiMatchesTagFilter, poiPassesReachabilityFilter, type Poi } from '@/lib/pois';
import { formatDistance } from '@/lib/utils';

export const AHEAD_HORIZON_OPTIONS = [25, 50, 100] as const;
export type AheadHorizonKm = (typeof AHEAD_HORIZON_OPTIONS)[number];

export type TrailAnchorSource = 'gps' | 'ruler';

export interface TrailAnchor {
	/** Position along the trail in SOBO km from the northern trailhead. */
	soboKm: number;
	source: TrailAnchorSource;
}

export function isAheadHorizonKm(v: number): v is AheadHorizonKm {
	return (AHEAD_HORIZON_OPTIONS as readonly number[]).includes(v);
}

/** User-facing label for a trail-km horizon (e.g. "50 km" or "31 mi"). */
export function formatAheadHorizon(horizonKm: number, units: UnitSystem, distancePrecision: number): string {
	return formatDistance(horizonKm, units, distancePrecision);
}

/** GPS on-trail when within threshold; otherwise ruler midpoint when set. */
export function resolveTrailAnchor(
	closestPoint: ClosestPoint | null,
	rulerRange: RulerRange | null,
	onTrailThresholdM: number,
): TrailAnchor | null {
	if (closestPoint && closestPoint.distance <= onTrailThresholdM) {
		return { soboKm: closestPoint.distanceFromStart / 1000, source: 'gps' };
	}
	if (rulerRange) {
		const midM = (rulerRange.distanceFromStartA + rulerRange.distanceFromStartB) / 2;
		return { soboKm: midM / 1000, source: 'ruler' };
	}
	return null;
}

/** Trail-km distance ahead of the anchor in the active travel direction, or null if behind. */
export function poiAheadKm(poiTrailKm: number, anchorSoboKm: number, direction: TrailDirection): number | null {
	if (direction === 'SOBO') {
		if (poiTrailKm <= anchorSoboKm) return null;
		return poiTrailKm - anchorSoboKm;
	}
	if (poiTrailKm >= anchorSoboKm) return null;
	return anchorSoboKm - poiTrailKm;
}

export function isPoiInAheadCorridor(
	poiTrailKm: number,
	anchorSoboKm: number,
	horizonKm: number,
	direction: TrailDirection,
): boolean {
	const ahead = poiAheadKm(poiTrailKm, anchorSoboKm, direction);
	return ahead !== null && ahead > 0 && ahead <= horizonKm;
}

export interface AheadCorridorFilterArgs {
	pois: readonly Poi[];
	anchorSoboKm: number;
	horizonKm: number;
	direction: TrailDirection;
	enabledPoiTypes: ReadonlySet<string>;
	enabledPoiTags: ReadonlySet<string>;
	includeRemotePois: boolean;
}

/** POIs inside the forward corridor that pass the same filters as the list panel. */
export function poisInAheadCorridor(args: AheadCorridorFilterArgs): Poi[] {
	const { pois, anchorSoboKm, horizonKm, direction, enabledPoiTypes, enabledPoiTags, includeRemotePois } = args;
	const out: Poi[] = [];
	for (const p of pois) {
		if (!isKnownType(p.type)) continue;
		if (!enabledPoiTypes.has(p.type)) continue;
		if (!poiMatchesTagFilter(p, enabledPoiTags)) continue;
		if (!poiPassesReachabilityFilter(p, includeRemotePois)) continue;
		if (!isPoiInAheadCorridor(p.trailKm, anchorSoboKm, horizonKm, direction)) continue;
		out.push(p);
	}
	out.sort((a, b) => {
		const da = poiAheadKm(a.trailKm, anchorSoboKm, direction) ?? Number.POSITIVE_INFINITY;
		const db = poiAheadKm(b.trailKm, anchorSoboKm, direction) ?? Number.POSITIVE_INFINITY;
		return da - db;
	});
	return out;
}

/** Inclusive SOBO km window `[from, to]` for the corridor (for summary labels). */
export function aheadCorridorSoboRange(
	anchorSoboKm: number,
	horizonKm: number,
	direction: TrailDirection,
	totalKm: number,
): { from: number; to: number } {
	if (direction === 'SOBO') {
		return { from: anchorSoboKm, to: Math.min(totalKm, anchorSoboKm + horizonKm) };
	}
	return { from: Math.max(0, anchorSoboKm - horizonKm), to: anchorSoboKm };
}
