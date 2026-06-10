/**
 * Shared constants, types, and pure helpers for the elevation chart family
 * (ElevationChart, ChartTooltipSync, useElevationChartRulerDrag).
 */
import { type SacBucket, type SurfaceBucket } from '@/lib/trail-osm-tags';
import { GRADE_BAND_ASCENT_COLORS, GRADE_BAND_DESCENT_COLORS } from '@/components/map/trail-route-constants';
import { TRAIL_SECTIONS } from '@/lib/trail-sections';

export const SURFACE_BUCKETS: readonly SurfaceBucket[] = ['paved', 'unpaved', 'gravel', 'ground', 'rock', 'unknown'];
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

export type PinnedPoint = { distanceM: number; elevation: number };

export function formatHikingTime(minutes: number): string {
	if (minutes < 60) return `${minutes}m`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
