import { useEffect } from 'react';
import { useMapStore, useStore, type ClosestPoint, type MapStoreState } from '@/lib/store';
import { AUTO_TRACK_MAX_JUMP_KM, AUTO_TRACK_MAX_OFF_TRAIL_M } from '@/lib/completion';

/** Fixes with worse reported accuracy cannot prove the stretch was walked. */
const MAX_ACCURACY_M = 75;

/**
 * Records hiking progress automatically from GPS: every consecutive pair of
 * on-trail fixes marks the trail km between them as completed. Guards keep
 * the record honest - off-trail or low-accuracy fixes break the chain, and a
 * jump longer than AUTO_TRACK_MAX_JUMP_KM (drive, tunnel, app reopened
 * elsewhere) starts a new chain instead of marking the skipped stretch.
 *
 * Fixes are read through a store subscription, not a selector: this runs in
 * MapContent, which a selector would re-render, with the whole map below it,
 * on every published fix.
 */
export function useCompletionAutoTrack(): void {
	const enabled = useMapStore((s: MapStoreState) => s.completionAutoTrack);
	const markCompleted = useMapStore((s: MapStoreState) => s.markCompleted);

	useEffect(() => {
		if (!enabled) return;
		let lastKm: number | null = null;
		const onFix = (closestPoint: ClosestPoint | null): void => {
			// The fix's accuracy is in the map store, written before the closest point.
			const accuracy = useMapStore.getState().userLocation?.accuracy;
			if (!closestPoint || closestPoint.distance > AUTO_TRACK_MAX_OFF_TRAIL_M) {
				lastKm = null;
				return;
			}
			if (typeof accuracy === 'number' && accuracy > MAX_ACCURACY_M) {
				lastKm = null;
				return;
			}
			const km = closestPoint.distanceFromStart / 1000;
			const last = lastKm;
			lastKm = km;
			if (last === null) return;
			const delta = Math.abs(km - last);
			if (delta === 0 || delta > AUTO_TRACK_MAX_JUMP_KM) return;
			markCompleted(Math.min(last, km), Math.max(last, km));
		};
		onFix(useStore.getState().closestPoint);
		return useStore.subscribe((state, prev) => {
			if (state.closestPoint !== prev.closestPoint) onFix(state.closestPoint);
		});
	}, [enabled, markCompleted]);
}
