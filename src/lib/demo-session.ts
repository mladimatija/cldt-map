/**
 * End-user demo session: snapshots persisted progress data, overlays rich
 * sample waypoints/journal/completion, drives the walk simulator, and
 * restores the visitor's real localStorage state on exit.
 */
import { useMapStore } from '@/lib/store';
import { buildDemoSeedData, DEMO_START_KM } from '@/lib/demo-seed';
import { releaseWalkSim, startWalkSim } from '@/lib/walk-sim';
import type { CompletionInterval } from '@/lib/completion';
import type { JournalEntry, UserWaypoint } from '@/lib/user-waypoints';

export const DEMO_SPEED_KMH = 4;

export interface DemoPersistSnapshot {
	userWaypoints: UserWaypoint[];
	journalEntries: JournalEntry[];
	completedIntervals: CompletionInterval[];
}

export async function enterDemoSession(): Promise<boolean> {
	const map = useMapStore.getState();
	if (map.demoModeActive) return true;

	const snapshot: DemoPersistSnapshot = {
		userWaypoints: [...map.userWaypoints],
		journalEntries: [...map.journalEntries],
		completedIntervals: [...map.completedIntervals],
	};

	map.enterDemoMode(snapshot);

	const seed = buildDemoSeedData(DEMO_START_KM);
	useMapStore.setState({
		userWaypoints: seed.waypoints,
		journalEntries: seed.journalEntries,
		completedIntervals: seed.completedIntervals,
	});

	return startWalkSim({
		startKm: DEMO_START_KM,
		speedKmh: DEMO_SPEED_KMH,
		walkDirection: 'SOBO',
		offsetM: 0,
		loopAtEnds: true,
	});
}

/** Stops the simulated hike, restores snapshotted data, and hands GPS back to the device. */
export function exitDemoSession(): void {
	const map = useMapStore.getState();
	if (!map.demoModeActive) return;

	const snapshot = map.demoPersistSnapshot;
	releaseWalkSim();

	useMapStore.setState({
		demoModeActive: false,
		demoPersistSnapshot: null,
		userWaypoints: snapshot?.userWaypoints ?? [],
		journalEntries: snapshot?.journalEntries ?? [],
		completedIntervals: snapshot?.completedIntervals ?? [],
	});
}
