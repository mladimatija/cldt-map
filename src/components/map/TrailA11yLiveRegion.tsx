'use client';

/**
 * Single polite ARIA live region for trail/map narration. Components push
 * messages through the store `announce()` action; the nonce key forces React to
 * replace the node so screen readers re-announce even identical consecutive
 * text. Visually hidden (sr-only) and inert for non-AT users.
 */
import React from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';

export function TrailA11yLiveRegion(): React.ReactElement {
	const announcement = useMapStore((state: MapStoreState) => state.a11yAnnouncement);
	return (
		<div aria-atomic="true" aria-live="polite" className="sr-only" role="status">
			{announcement ? <span key={announcement.nonce}>{announcement.text}</span> : null}
		</div>
	);
}
