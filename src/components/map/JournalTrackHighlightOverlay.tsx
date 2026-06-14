'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { findNearestPointIndex } from '@/lib/distance-utils';
import { sliceTrackPoints } from '@/lib/journal-track-link';

const JOURNAL_PANE = 'journal-highlight-pane';

const TRAIL_STYLE: L.PolylineOptions = {
	color: '#06b6d4',
	weight: 6,
	opacity: 0.9,
	dashArray: '10 8',
	interactive: false,
	pane: JOURNAL_PANE,
};

/**
 * Ephemeral map highlight for journal entries: cyan dashed official-trail band
 * plus solid recorded GPX segment when a track link is active.
 */
export function JournalTrackHighlightOverlay(): null {
	const map = useMap();
	const preview = useMapStore((s: MapStoreState) => s.journalPreview);
	const importedTracks = useMapStore((s: MapStoreState) => s.importedTracks);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);

	const groupRef = useRef<L.LayerGroup | null>(null);

	useEffect(() => {
		const removeGroup = (): void => {
			if (groupRef.current) {
				map.removeLayer(groupRef.current);
				groupRef.current = null;
			}
		};

		if (!preview || enhancedTrailPoints.length < 2) {
			removeGroup();
			return;
		}

		if (!map.getPane(JOURNAL_PANE)) {
			const pane = map.createPane(JOURNAL_PANE);
			pane.classList.add(JOURNAL_PANE);
			const markerPane = map.getPane('markerPane');
			if (markerPane?.parentNode) markerPane.parentNode.insertBefore(pane, markerPane);
		}

		const group = L.layerGroup();
		const loM = Math.min(preview.trailStartKm, preview.trailEndKm) * 1000;
		const hiM = Math.max(preview.trailStartKm, preview.trailEndKm) * 1000;
		if (Math.abs(hiM - loM) > 50) {
			const startIdx = findNearestPointIndex(enhancedTrailPoints, loM);
			const endIdx = findNearestPointIndex(enhancedTrailPoints, hiM);
			const lo = Math.min(startIdx, endIdx);
			const hi = Math.max(startIdx, endIdx);
			if (hi - lo >= 1) {
				const latlngs = enhancedTrailPoints.slice(lo, hi + 1).map((p) => [p.lat, p.lng] as [number, number]);
				group.addLayer(L.polyline(latlngs, TRAIL_STYLE));
			}
		}

		if (preview.trackId && preview.startIdx !== undefined && preview.endIdx !== undefined) {
			const track = importedTracks.find((t) => t.id === preview.trackId);
			if (track) {
				const link = {
					trackId: preview.trackId,
					startIdx: preview.startIdx,
					endIdx: preview.endIdx,
					trackName: track.name,
				};
				const points = sliceTrackPoints(track, link);
				if (points.length >= 2) {
					const latlngs = points.map((p) => [p.lat, p.lng] as [number, number]);
					group.addLayer(
						L.polyline(latlngs, {
							color: preview.trackColor ?? track.color,
							weight: 5,
							opacity: 0.95,
							interactive: false,
							pane: JOURNAL_PANE,
						}),
					);
				}
			}
		}

		group.addTo(map);
		groupRef.current = group;
		return removeGroup;
	}, [map, preview, enhancedTrailPoints, importedTracks]);

	return null;
}
