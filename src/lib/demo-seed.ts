/**
 * Ephemeral sample data for the end-user demo hike. Applied only for the
 * duration of a /demo session; the demo session manager restores the
 * visitor's real waypoints, journal, and completion on exit.
 */
import type { CompletionInterval } from '@/lib/completion';
import { newId, type JournalEntry, type UserWaypoint } from '@/lib/user-waypoints';
import type { WaypointCategoryId } from '@/lib/waypoint-categories';
import { useStore } from '@/lib/store';

export const DEMO_START_KM = 100;

const WAYPOINT_OFFSETS_KM = [2, 7.5, 12];
const WAYPOINT_CATEGORIES: WaypointCategoryId[] = ['water', 'camp', 'resupply'];

export interface DemoSeedData {
	waypoints: UserWaypoint[];
	journalEntries: JournalEntry[];
	completedIntervals: CompletionInterval[];
}

function trailPointAtKm(km: number): { lat: number; lng: number; trailKm: number } | null {
	const points = useStore.getState().enhancedTrailPoints ?? [];
	if (points.length < 2) return null;
	const totalKm = points[points.length - 1].distanceFromStart / 1000;
	const clamped = Math.max(0, Math.min(totalKm - 0.1, km));
	const idx = points.findIndex((p) => p.distanceFromStart / 1000 >= clamped);
	if (idx === -1) return null;
	const pt = points[idx];
	return { lat: pt.lat, lng: pt.lng, trailKm: pt.distanceFromStart / 1000 };
}

/** Rich seed around the demo start: 2-3 waypoints, one journal entry, ~20 km completion. */
export function buildDemoSeedData(startKm: number = DEMO_START_KM): DemoSeedData {
	const createdAt = new Date().toISOString();
	const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

	const waypoints: UserWaypoint[] = [];
	for (let i = 0; i < WAYPOINT_OFFSETS_KM.length; i++) {
		const pt = trailPointAtKm(startKm + WAYPOINT_OFFSETS_KM[i]);
		if (!pt) continue;
		waypoints.push({
			id: newId(),
			lat: pt.lat,
			lng: pt.lng,
			name: `Demo waypoint +${WAYPOINT_OFFSETS_KM[i]} km`,
			note: 'Sample waypoint for the demo hike.',
			category: WAYPOINT_CATEGORIES[i] ?? 'generic',
			createdAt,
			trailKm: pt.trailKm,
		});
	}

	const journalEntries: JournalEntry[] = [
		{
			id: newId(),
			date: yesterday,
			text: 'Forest ridge day on the demo hike - sheltered camp by a spring after a steady climb.',
			startKm: startKm - 10,
			endKm: startKm + 10,
			createdAt,
		},
	];

	const completedIntervals: CompletionInterval[] = [{ startKm: startKm - 10, endKm: startKm + 10 }];

	return { waypoints, journalEntries, completedIntervals };
}
