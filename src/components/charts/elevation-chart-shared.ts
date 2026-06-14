/**
 * Shared constants, types, and pure helpers for the elevation chart family
 * (ElevationChart, ChartTooltipSync, useElevationChartRulerDrag).
 */
import {
	bucketSac,
	bucketSurface,
	findRunAtKm,
	type SacBucket,
	type SurfaceBucket,
	type TrailOsmTagRun,
} from '@/lib/trail-osm-tags';
import { findNearestPointIndex } from '@/lib/distance-utils';
import { type EnhancedTrailPoint } from '@/lib/store/types';
import { type TrailDirection } from '@/lib/types';
import { GRADE_BAND_ASCENT_COLORS, GRADE_BAND_DESCENT_COLORS } from '@/components/map/trail-route-constants';
import { TRAIL_SECTIONS } from '@/lib/trail-sections';

export { SURFACE_BUCKETS } from '@/lib/trail-osm-tags';
export const SAC_BUCKETS: readonly SacBucket[] = [
	'hiking',
	'mountain_hiking',
	'demanding_mountain_hiking',
	'alpine_hiking',
	'demanding_alpine_hiking',
	'difficult_alpine_hiking',
	'untagged',
];

/** Section bucket keys mirror TRAIL_SECTIONS.nameKey (sectionA / sectionB / sectionC). */
export const SECTION_BUCKETS: readonly string[] = TRAIL_SECTIONS.map((s) => s.nameKey);
export const SECTION_COLOR_BY_KEY: Readonly<Record<string, string>> = Object.fromEntries(
	TRAIL_SECTIONS.map((s) => [s.nameKey, s.color]),
);

/** Grade bucket keys: g{band 0..4}_{asc|desc}. */
export const GRADE_BUCKETS: readonly string[] = (['asc', 'desc'] as const).flatMap((sign) =>
	[0, 1, 2, 3, 4].map((band) => `g${band}_${sign}`),
);

/** i18n keys under mapControls.layers.trailStyle for each grade band (0 flat .. 4 extreme). */
export const GRADE_BAND_LABEL_KEYS = [
	'legendFlat',
	'legendModerate',
	'legendSteep',
	'legendVerySteep',
	'legendExtreme',
] as const;

export function gradeColorForKey(key: string): string {
	// Regex domain `[0-4]` matches the closed band range; an out-of-range key
	// from a future change would fail to match and produce undefined rather
	// than silently indexing past the 5-element palette arrays.
	const [, bandStr, sign] = /^g([0-4])_(asc|desc)$/.exec(key) ?? [];
	const band = Number(bandStr);
	return sign === 'desc' ? GRADE_BAND_DESCENT_COLORS[band] : GRADE_BAND_ASCENT_COLORS[band];
}

export interface ElevationPoint {
	distance: number;
	elevation: number;
	lat?: number;
	lng?: number;
}

export type ElevationChartFillMode = 'surface' | 'sac' | 'sections' | 'grade' | null;

export interface OsmAtTrailKm {
	run: TrailOsmTagRun | null;
	surfaceBucket: SurfaceBucket;
	sacBucket: SacBucket;
}

export interface GradeAtTrailKm {
	gradeBand: 0 | 1 | 2 | 3 | 4;
	/** Signed grade percent in the active travel direction. */
	gradePct: number;
	sign: 'asc' | 'desc';
	color: string;
}

/** Map chart km (direction-relative) to the grade band and signed percent at that point. */
export function resolveGradeAtTrailKm(
	km: number,
	enhancedTrailPoints: readonly EnhancedTrailPoint[],
): GradeAtTrailKm | null {
	if (!enhancedTrailPoints.length) return null;
	const ep = enhancedTrailPoints[findNearestPointIndex(enhancedTrailPoints, km * 1000)];
	if (!ep) return null;
	const sign = ep.gradePct < 0 ? 'desc' : 'asc';
	return {
		gradeBand: ep.gradeBand,
		gradePct: ep.gradePct,
		sign,
		color: gradeColorForKey(`g${ep.gradeBand}_${sign}`),
	};
}

/** Map chart km (direction-relative) to the OSM tag run and coarse buckets at that point. */
export function resolveOsmAtTrailKm(
	km: number,
	direction: TrailDirection,
	totalKm: number,
	runs: TrailOsmTagRun[] | null | undefined,
): OsmAtTrailKm | null {
	if (!runs?.length) return null;
	const soboKm = direction === 'SOBO' ? km : Math.max(0, totalKm - km);
	const run = findRunAtKm(runs, soboKm);
	return {
		run,
		surfaceBucket: bucketSurface(run?.surface ?? null),
		sacBucket: bucketSac(run?.sac_scale ?? null),
	};
}

export type PinnedPoint = { distanceM: number; elevation: number };

export function formatHikingTime(minutes: number): string {
	if (minutes < 60) return `${minutes}m`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
