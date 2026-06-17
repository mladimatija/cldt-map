/**
 * Personal notes on curated POIs.
 *
 * A private, on-device free-text note attached to any curated POI (peak, town,
 * hut, water, ...), the general-purpose sibling of the water-status log: the
 * official dataset says what a place is, the note says whatever the hiker wants
 * to remember about it ("locked gate", "great bivvy spot", "owner's number").
 * One note per POI id, stored only in the browser and never uploaded. Mirrors
 * the `poiWaterLog` slice pattern (persisted Record + sanitize-on-rehydrate).
 */

/** Generous cap; matches the personal-waypoint note limit so the two
 *  free-text affordances feel the same and a single field can never bloat
 *  localStorage. */
export const POI_NOTE_MAX_LENGTH = 2000;

/** Trim and cap a raw note. Returns '' for whitespace-only input so callers
 *  can treat "empty after normalize" as "remove the note". */
export function normalizePoiNote(text: string): string {
	return text.trim().slice(0, POI_NOTE_MAX_LENGTH);
}

/** Sanitizes the rehydrated `poiNotes` map: drops non-string and empty values
 *  and caps length, so a corrupt or oversized localStorage value can never
 *  render garbage or bloat memory. Always returns a fresh plain object. */
export function sanitizePoiNotes(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== 'object') return {};
	const out: Record<string, string> = {};
	for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value !== 'string') continue;
		const normalized = normalizePoiNote(value);
		if (normalized) out[id] = normalized;
	}
	return out;
}
