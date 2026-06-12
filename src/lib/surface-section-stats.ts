import { TRAIL_SECTIONS } from '@/lib/trail-sections';
import { bucketSurface, type SurfaceBucket, type TrailOsmTagRun } from '@/lib/trail-osm-tags';

/** Display order for surface mix rows in section tooltips. */
export const SURFACE_BUCKETS: SurfaceBucket[] = ['paved', 'unpaved', 'gravel', 'ground', 'rock', 'unknown'];

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
			const overlapStart = Math.max(run.fromKm, TRAIL_SECTIONS[si].startKm);
			const overlapEnd = Math.min(run.toKm, sectionEnds[si]);
			if (overlapEnd > overlapStart) {
				kmBySection[si][bucket] += overlapEnd - overlapStart;
			}
		}
	}

	return TRAIL_SECTIONS.map((_, si) => {
		const kmByBucket = kmBySection[si];
		const taggedKm = SURFACE_BUCKETS.reduce((sum, b) => sum + kmByBucket[b], 0);
		return { sectionIndex: si, kmByBucket, taggedKm };
	});
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
