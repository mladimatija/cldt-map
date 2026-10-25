/** One row of the HGSS pre-hike readiness checklist. Rows with an `action`
 *  deep-link into the surface that satisfies them (the settings overlays card
 *  for closures, the offline-maps card for offline, the emergency panel for
 *  medical and check-in); advice-only rows carry none. */
export interface PrehikeItem {
	key: string;
	action?: 'closures' | 'offline' | 'emergency';
}

/** The checklist in display order: the Help panel renders it, and the store
 *  keeps tick state only for these keys. */
export const PREHIKE_ITEMS: readonly PrehikeItem[] = [
	{ key: 'closures', action: 'closures' },
	{ key: 'offline', action: 'offline' },
	{ key: 'medical', action: 'emergency' },
	{ key: 'checkin', action: 'emergency' },
	{ key: 'tellSomeone' },
	{ key: 'gear' },
	{ key: 'markedTrails' },
];

export const PREHIKE_KEYS: ReadonlySet<string> = new Set(PREHIKE_ITEMS.map((item) => item.key));
