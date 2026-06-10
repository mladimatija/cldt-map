/**
 * Off-route alert state machine.
 *
 * The settings toggle enables the CAPABILITY; this machine decides when an
 * alarm is actually warranted. The alert is dormant until the hiker has
 * demonstrably been ON the trail (several consecutive close fixes), which is
 * what makes the feature safe to leave enabled permanently: someone at home
 * in Zagreb, driving the coast road, or sightseeing in Split never arms it,
 * so they can never be nagged. Being on-trail IS the geofence.
 *
 *   dormant --(ARM_FIXES fixes within ARM_WITHIN_M)--> armed
 *   armed   --(ALERT_FIXES fixes beyond ALERT_BEYOND_M)--> alerting
 *   armed   --(DISARM_FIXES fixes beyond DISARM_BEYOND_M)--> dormant
 *   alerting--(fix within ARM_WITHIN_M)--> armed   (back on trail)
 *   alerting--(DISARM_FIXES fixes beyond DISARM_BEYOND_M)--> dormant
 *
 * The dormant transition out of armed/alerting covers genuinely leaving the
 * trail (taxi to town, end of the day): the alarm silences itself and the
 * machine re-arms automatically the next time the hiker is on trail.
 * Consecutive-fix requirements plus an accuracy gate keep a single bad GPS
 * fix (urban canyon, tunnel exit) from arming or alarming.
 */

export type OffRoutePhase = 'dormant' | 'armed' | 'alerting';

export interface OffRouteMachineState {
	phase: OffRoutePhase;
	/** Consecutive on-trail fixes while dormant. */
	onCount: number;
	/** Consecutive beyond-alert fixes while armed. */
	offCount: number;
	/** Consecutive beyond-disarm fixes while armed or alerting. */
	awayCount: number;
}

export const OFF_ROUTE = {
	/** Fixes at or under this distance (m) count toward arming; also the
	 *  "back on trail" threshold that clears an active alert. */
	ARM_WITHIN_M: 100,
	ARM_FIXES: 3,
	/** Fixes beyond this distance (m) count toward raising the alert. Keeps a
	 *  comfortable hysteresis gap above ARM_WITHIN_M so switchbacks and GPS
	 *  wobble don't flap the state. */
	ALERT_BEYOND_M: 200,
	ALERT_FIXES: 3,
	/** Sustained distance (m) past which the hiker has clearly left the trail
	 *  on purpose; the machine returns to dormant instead of nagging. */
	DISARM_BEYOND_M: 2000,
	DISARM_FIXES: 5,
	/** Fixes with worse reported accuracy (m) are ignored entirely - they
	 *  cannot prove either presence on or absence from the trail. */
	MAX_ACCURACY_M: 75,
} as const;

export const OFF_ROUTE_INITIAL: OffRouteMachineState = {
	phase: 'dormant',
	onCount: 0,
	offCount: 0,
	awayCount: 0,
};

/**
 * Advances the machine by one GPS fix. `distanceToTrailM` is the distance
 * from the user to the nearest trail point (null when unknown);
 * `accuracyM` is the fix's reported accuracy when available.
 */
export function offRouteStep(
	state: OffRouteMachineState,
	distanceToTrailM: number | null,
	accuracyM?: number,
): OffRouteMachineState {
	// Unusable fix: hold the current state, counts included. A string of bad
	// fixes neither arms nor alarms.
	if (distanceToTrailM === null || !Number.isFinite(distanceToTrailM)) return state;
	if (typeof accuracyM === 'number' && accuracyM > OFF_ROUTE.MAX_ACCURACY_M) return state;

	switch (state.phase) {
		case 'dormant': {
			if (distanceToTrailM <= OFF_ROUTE.ARM_WITHIN_M) {
				const onCount = state.onCount + 1;
				if (onCount >= OFF_ROUTE.ARM_FIXES) {
					return { phase: 'armed', onCount: 0, offCount: 0, awayCount: 0 };
				}
				return { ...state, onCount };
			}
			return state.onCount === 0 ? state : { ...state, onCount: 0 };
		}
		case 'armed': {
			if (distanceToTrailM > OFF_ROUTE.DISARM_BEYOND_M) {
				const awayCount = state.awayCount + 1;
				if (awayCount >= OFF_ROUTE.DISARM_FIXES) return { ...OFF_ROUTE_INITIAL };
				// Far away also counts as off-route while it lasts.
				return { ...state, awayCount, offCount: state.offCount + 1, phase: nextArmedPhase(state.offCount + 1) };
			}
			if (distanceToTrailM > OFF_ROUTE.ALERT_BEYOND_M) {
				const offCount = state.offCount + 1;
				return { ...state, offCount, awayCount: 0, phase: nextArmedPhase(offCount) };
			}
			return state.offCount === 0 && state.awayCount === 0 ? state : { ...state, offCount: 0, awayCount: 0 };
		}
		case 'alerting': {
			if (distanceToTrailM <= OFF_ROUTE.ARM_WITHIN_M) {
				// Back on trail: alert resolves, stays armed for the next drift.
				return { phase: 'armed', onCount: 0, offCount: 0, awayCount: 0 };
			}
			if (distanceToTrailM > OFF_ROUTE.DISARM_BEYOND_M) {
				const awayCount = state.awayCount + 1;
				if (awayCount >= OFF_ROUTE.DISARM_FIXES) return { ...OFF_ROUTE_INITIAL };
				return { ...state, awayCount };
			}
			return state.awayCount === 0 ? state : { ...state, awayCount: 0 };
		}
	}
}

function nextArmedPhase(offCount: number): OffRoutePhase {
	return offCount >= OFF_ROUTE.ALERT_FIXES ? 'alerting' : 'armed';
}
