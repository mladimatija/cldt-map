'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { useTranslations } from 'next-intl';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';

export default function ImportedTrackLayer(): null {
	const map = useMap();
	const t = useTranslations('imports');
	const importedTracks = useMapStore((s: MapStoreState) => s.importedTracks);
	const setHoveredImportedTrackId = useMapStore((s: MapStoreState) => s.setHoveredImportedTrackId);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);

	const polylinesRef = useRef<Map<string, L.Polyline>>(new Map());
	const tooltipRef = useRef<L.Tooltip | null>(null);
	// Keep enhancedTrailPoints in a ref so mousemove handlers always see the latest value
	// without requiring polylines to be recreated on every trail-point update
	const enhancedTrailPointsRef = useRef(enhancedTrailPoints);
	const lastMoveRef = useRef(0);

	useEffect(() => {
		enhancedTrailPointsRef.current = enhancedTrailPoints;
	}, [enhancedTrailPoints]);

	useEffect(() => {
		const existing = polylinesRef.current;
		const newIds = new Set(importedTracks.map((t) => t.id));

		// Remove deleted tracks
		for (const [id, poly] of existing) {
			if (!newIds.has(id)) {
				poly.remove();
				existing.delete(id);
			}
		}

		// Add new tracks
		for (const track of importedTracks) {
			if (existing.has(track.id)) continue;
			const latlngs = track.points.map((p) => [p.lat, p.lng] as L.LatLngTuple);
			if (latlngs.length === 0) continue;

			const poly = L.polyline(latlngs, {
				color: track.color,
				weight: 3,
				opacity: 0.85,
				smoothFactor: 1,
			});

			poly.on('mouseover', () => {
				poly.setStyle({ weight: 6 });
				setHoveredImportedTrackId(track.id);
			});
			poly.on('mouseout', () => {
				poly.setStyle({ weight: 3 });
				setHoveredImportedTrackId(null);
				if (tooltipRef.current) {
					tooltipRef.current.remove();
					tooltipRef.current = null;
				}
			});
			poly.on('mousemove', (e: L.LeafletMouseEvent) => {
				// Throttle to ~10fps to avoid O(n) scan at 60fps
				const now = Date.now();
				if (now - lastMoveRef.current < 100) return;
				lastMoveRef.current = now;

				const pts = enhancedTrailPointsRef.current;
				if (pts.length === 0) return;

				const cursor = e.latlng;
				let minDist = Infinity;
				// Use hint-based forward scan to avoid full O(n) scan every move
				for (const pt of pts) {
					const d = cursor.distanceTo(L.latLng(pt.lat, pt.lng));
					if (d < minDist) minDist = d;
					else if (d > minDist + 200) break; // early exit when diverging
				}

				const label = t('distanceFromTrail', { distance: Math.round(minDist) });
				if (!tooltipRef.current) {
					tooltipRef.current = L.tooltip({ permanent: false, direction: 'top' })
						.setContent(label)
						.setLatLng(e.latlng)
						.addTo(map);
				} else {
					tooltipRef.current.setContent(label).setLatLng(e.latlng);
				}
			});

			poly.addTo(map);
			existing.set(track.id, poly);
		}
	}, [importedTracks, map, setHoveredImportedTrackId, t]);

	// Cleanup on unmount
	useEffect(() => {
		const polylines = polylinesRef.current;
		const tooltip = tooltipRef;
		return () => {
			for (const poly of polylines.values()) poly.remove();
			polylines.clear();
			if (tooltip.current) {
				tooltip.current.remove();
				tooltip.current = null;
			}
		};
	}, []);

	return null;
}
