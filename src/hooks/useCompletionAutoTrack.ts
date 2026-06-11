import { useEffect, useRef } from 'react';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { AUTO_TRACK_MAX_JUMP_KM, AUTO_TRACK_MAX_OFF_TRAIL_M } from '@/lib/completion';

/** Fixes with worse reported accuracy cannot prove the stretch was walked. */
const MAX_ACCURACY_M = 75;

/**
 * Records hiking progress automatically from GPS: every consecutive pair of
 * on-trail fixes marks the trail km between them as completed. Guards keep
 * the record honest - off-trail or low-accuracy fixes break the chain, and a
 * jump longer than AUTO_TRACK_MAX_JUMP_KM (drive, tunnel, app reopened
 * elsewhere) starts a new chain instead of marking the skipped stretch.
 */
export function useCompletionAutoTrack(): void {
	const enabled = useMapStore((s: MapStoreState) => s.completionAutoTrack);
	const markCompleted = useMapStore((s: MapStoreState) => s.markCompleted);
	const accuracy = useMapStore((s: MapStoreState) => s.userLocation?.accuracy);
	const closestPoint = useStore((s: StoreState) => s.closestPoint);

	const lastKmRef = useRef<number | null>(null);

	useEffect(() => {
		if (!enabled) {
			lastKmRef.current = null;
			return;
		}
		if (!closestPoint || closestPoint.distance > AUTO_TRACK_MAX_OFF_TRAIL_M) {
			lastKmRef.current = null;
			return;
		}
		if (typeof accuracy === 'number' && accuracy > MAX_ACCURACY_M) {
			lastKmRef.current = null;
			return;
		}
		const km = closestPoint.distanceFromStart / 1000;
		const last = lastKmRef.current;
		lastKmRef.current = km;
		if (last === null) return;
		const delta = Math.abs(km - last);
		if (delta === 0 || delta > AUTO_TRACK_MAX_JUMP_KM) return;
		markCompleted(Math.min(last, km), Math.max(last, km));
	}, [enabled, closestPoint, accuracy, markCompleted]);
}
