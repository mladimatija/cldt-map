'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { findNearestPointIndex } from '@/lib/distance-utils';

const PREVIEW_PANE = 'progress-preview-pane';

/** Amber dashed overlay for GPX add-to-progress preview - distinct from the
 *  solid green completion overlay so users can see both existing and pending
 *  stretches at once. */
const PREVIEW_STYLE: L.PolylineOptions = {
	color: '#f59e0b',
	weight: 6,
	opacity: 0.9,
	dashArray: '10 8',
	interactive: false,
	pane: PREVIEW_PANE,
};

/**
 * Ephemeral map highlight for km intervals about to be marked hiked from an
 * imported GPX track. Cleared when the user confirms or cancels the preview.
 */
export function ProgressPreviewOverlay(): null {
	const map = useMap();
	const intervals = useMapStore((s: MapStoreState) => s.progressPreviewIntervals);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);

	const groupRef = useRef<L.LayerGroup | null>(null);

	useEffect(() => {
		const removeGroup = (): void => {
			if (groupRef.current) {
				map.removeLayer(groupRef.current);
				groupRef.current = null;
			}
		};
		if (intervals.length === 0 || enhancedTrailPoints.length < 2) {
			removeGroup();
			return;
		}

		if (!map.getPane(PREVIEW_PANE)) {
			const pane = map.createPane(PREVIEW_PANE);
			pane.classList.add(PREVIEW_PANE);
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
			group.addLayer(L.polyline(latlngs, PREVIEW_STYLE));
		}
		group.addTo(map);
		groupRef.current = group;
		return removeGroup;
	}, [map, intervals, enhancedTrailPoints]);

	return null;
}
