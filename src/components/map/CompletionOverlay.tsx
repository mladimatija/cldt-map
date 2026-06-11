'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { findNearestPointIndex } from '@/lib/distance-utils';

/** Dedicated pane: the global stylesheet flattens every Leaflet pane to
 *  --z-map, so inside the shared overlay pane the trail polyline would cover
 *  this overlay whenever TrailRoute re-renders (SVG paints in add order).
 *  With pane z-indexes flattened, paint order follows DOM order - so the
 *  pane is inserted between the overlay pane (trail) and the marker pane,
 *  putting the green line above the trail but below every marker (section
 *  boundaries, endpoints, the user location dot). */
const COMPLETION_PANE = 'completion-overlay-pane';

/** Drawn over the trail polyline regardless of the active trail style, so
 *  progress stays visible with Sections / Grade / Surface colouring too.
 *  Literal colour (Leaflet writes SVG stroke attributes, where CSS variables
 *  do not resolve); value matches --cldt-green in theme.css. */
const COMPLETED_STYLE: L.PolylineOptions = {
	color: '#5ec687',
	weight: 5,
	opacity: 0.85,
	interactive: false,
	pane: COMPLETION_PANE,
};

/**
 * Green overlay for completed trail stretches. Pure renderer: reads the
 * persisted completion intervals and slices the enhanced trail points for
 * each one. Marking/unmarking lives in the progress panel and the
 * auto-track hook.
 */
export function CompletionOverlay(): null {
	const map = useMap();
	const show = useMapStore((s: MapStoreState) => s.showCompletionOverlay);
	const intervals = useMapStore((s: MapStoreState) => s.completedIntervals);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);

	const groupRef = useRef<L.LayerGroup | null>(null);

	useEffect(() => {
		const removeGroup = (): void => {
			if (groupRef.current) {
				map.removeLayer(groupRef.current);
				groupRef.current = null;
			}
		};
		if (!show || intervals.length === 0 || enhancedTrailPoints.length < 2) {
			removeGroup();
			return;
		}

		if (!map.getPane(COMPLETION_PANE)) {
			const pane = map.createPane(COMPLETION_PANE);
			pane.classList.add(COMPLETION_PANE);
			const markerPane = map.getPane('markerPane');
			if (markerPane?.parentNode) markerPane.parentNode.insertBefore(pane, markerPane);
		}
		const group = L.layerGroup();
		for (const iv of intervals) {
			const startIdx = findNearestPointIndex(enhancedTrailPoints, iv.startKm * 1000);
			const endIdx = findNearestPointIndex(enhancedTrailPoints, iv.endKm * 1000);
			const lo = Math.min(startIdx, endIdx);
			const hi = Math.max(startIdx, endIdx);
			if (hi - lo < 1) continue;
			const latlngs = enhancedTrailPoints.slice(lo, hi + 1).map((p) => [p.lat, p.lng] as [number, number]);
			group.addLayer(L.polyline(latlngs, COMPLETED_STYLE));
		}
		group.addTo(map);
		groupRef.current = group;
		return removeGroup;
	}, [map, show, intervals, enhancedTrailPoints]);

	return null;
}
