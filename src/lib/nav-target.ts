/**
 * Navigation target: a POI or personal waypoint the user has pinned so the live
 * HUD can show the straight-line distance and compass bearing to it. This is a
 * "which way and how far" aid, NOT routing - no path is ever computed, matching
 * the app's deliberate no-turn-by-turn stance.
 */
export type NavTargetSource = 'poi' | 'waypoint';

export interface NavTarget {
	/** Id of the source POI or waypoint, so re-pinning the same one is idempotent. */
	id: string;
	lat: number;
	lng: number;
	/** Display name captured at pin time so the HUD stays self-sufficient even
	 *  when the source POI is filtered out or its marker is off-screen. */
	name: string;
	source: NavTargetSource;
}

function isFiniteCoord(value: unknown, max: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= max;
}

/**
 * Validates a persisted/raw nav target, returning a clean NavTarget or null.
 * Guards against a corrupt or hand-edited localStorage value rendering a HUD
 * with garbage coordinates.
 */
export function sanitizeNavTarget(raw: unknown): NavTarget | null {
	if (!raw || typeof raw !== 'object') return null;
	const t = raw as Record<string, unknown>;
	if (typeof t.id !== 'string' || t.id.length === 0) return null;
	if (!isFiniteCoord(t.lat, 90) || !isFiniteCoord(t.lng, 180)) return null;
	if (t.source !== 'poi' && t.source !== 'waypoint') return null;
	const name = typeof t.name === 'string' ? t.name.slice(0, 200) : '';
	return { id: t.id, lat: t.lat, lng: t.lng, name, source: t.source };
}
