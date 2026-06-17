'use client';

/** Starts the demo hike once trail data is loaded; restores real state on exit. */
import { useEffect } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { enterDemoSession, exitDemoSession } from '@/lib/demo-session';

export function DemoSessionController(): null {
	const gpxLoaded = useMapStore((s: MapStoreState) => s.gpxLoaded);

	// Enter and exit are paired in ONE effect so they can never desync: the
	// cleanup always restores the visitor's real progress when the demo route
	// unmounts (or remounts). Both enterDemoSession and exitDemoSession are
	// idempotent (guarded on demoModeActive), so a Strict-Mode / Fast-Refresh
	// mount->unmount->remount safely re-enters with a fresh real-data snapshot
	// instead of leaving the demo half-torn-down (the old startedRef approach
	// blocked re-entry after its own cleanup had already restored state).
	useEffect(() => {
		if (!gpxLoaded) return;
		void enterDemoSession();
		return () => exitDemoSession();
	}, [gpxLoaded]);

	return null;
}
