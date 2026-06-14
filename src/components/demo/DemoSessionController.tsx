'use client';

/** Starts the demo hike once trail data is loaded; restores real state on unmount. */
import { useEffect, useRef } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { enterDemoSession, exitDemoSession } from '@/lib/demo-session';

export function DemoSessionController(): null {
	const gpxLoaded = useMapStore((s: MapStoreState) => s.gpxLoaded);
	const startedRef = useRef(false);

	useEffect(() => {
		if (!gpxLoaded || startedRef.current) return;
		startedRef.current = true;
		void enterDemoSession();
	}, [gpxLoaded]);

	useEffect(() => () => exitDemoSession(), []);

	return null;
}
