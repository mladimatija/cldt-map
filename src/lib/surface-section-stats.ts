import { TRAIL_SECTIONS } from '@/lib/trail-sections';
import {
	bucketSurface,
	rangeOverlapKm,
	SURFACE_BUCKETS,
	type SurfaceBucket,
	type TrailOsmTagRun,
} from '@/lib/trail-osm-tags';

export interface SurfaceMixEntry {
	bucket: SurfaceBucket;
	pct: number;
}

export interface SectionSurfaceBreakdown {
	sectionIndex: number;
	kmByBucket: Record<SurfaceBucket, number>;
	taggedKm: number;
}

function emptyBuckets(): Record<SurfaceBucket, number> {
	return { paved: 0, unpaved: 0, gravel: 0, ground: 0, rock: 0, unknown: 0 };
}

/** Sum OSM tag run lengths per surface bucket within each trail section window. */
export function computeSurfaceBreakdownBySection(
	runs: TrailOsmTagRun[],
	trailTotalKm: number,
): SectionSurfaceBreakdown[] {
	const sectionEnds = TRAIL_SECTIONS.map((s) => (s.endKm === Infinity ? trailTotalKm : s.endKm));
	const kmBySection = TRAIL_SECTIONS.map(() => emptyBuckets());

	for (const run of runs) {
		if (run.toKm <= run.fromKm) continue;
		const bucket = bucketSurface(run.surface);
		for (let si = 0; si < TRAIL_SECTIONS.length; si++) {
			kmBySection[si][bucket] += rangeOverlapKm(run.fromKm, run.toKm, TRAIL_SECTIONS[si].startKm, sectionEnds[si]);
		}
	}

	return TRAIL_SECTIONS.map((_, si) => {
		const kmByBucket = kmBySection[si];
		const taggedKm = SURFACE_BUCKETS.reduce((sum, b) => sum + kmByBucket[b], 0);
		return { sectionIndex: si, kmByBucket, taggedKm };
	});
}

/**
 * Dominant surface bucket by tagged km across runs overlapping [fromKm, toKm]
 * (SOBO km, order-independent). 'unknown' is excluded so untagged stretches
 * never win. Returns null when no overlapping run has a recognized surface -
 * callers use that to omit the surface line entirely. Overlap math mirrors
 * computeSurfaceBreakdownBySection.
 */
export function dominantSurfaceForKmRange(runs: TrailOsmTagRun[], fromKm: number, toKm: number): SurfaceBucket | null {
	const lo = Math.min(fromKm, toKm);
	const hi = Math.max(fromKm, toKm);
	const kmByBucket = emptyBuckets();
	for (const run of runs) {
		if (run.toKm <= run.fromKm) continue;
		kmByBucket[bucketSurface(run.surface)] += rangeOverlapKm(run.fromKm, run.toKm, lo, hi);
	}
	let best: SurfaceBucket | null = null;
	let bestKm = 0;
	for (const bucket of SURFACE_BUCKETS) {
		if (bucket === 'unknown') continue;
		if (kmByBucket[bucket] > bestKm) {
			bestKm = kmByBucket[bucket];
			best = bucket;
		}
	}
	return best;
}

/** Percentage rows for one section, sorted descending, omitting empty buckets. */
export function surfaceMixForSection(breakdowns: SectionSurfaceBreakdown[], sectionIndex: number): SurfaceMixEntry[] {
	const section = breakdowns[sectionIndex];
	if (!section || section.taggedKm <= 0) return [];
	const entries: SurfaceMixEntry[] = [];
	for (const bucket of SURFACE_BUCKETS) {
		const km = section.kmByBucket[bucket];
		if (km <= 0) continue;
		entries.push({ bucket, pct: (km / section.taggedKm) * 100 });
	}
	entries.sort((a, b) => b.pct - a.pct);
	return entries;
}
