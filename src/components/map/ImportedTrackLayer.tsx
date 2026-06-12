'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { useTranslations } from 'next-intl';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { buildSpatialGrid, type SpatialGrid } from '@/lib/spatial-grid';
import { kmToMiles } from '@/lib/utils';

export default function ImportedTrackLayer(): null {
	const map = useMap();
	const t = useTranslations('imports');
	const importedTracks = useMapStore((s: MapStoreState) => s.importedTracks);
	const setHoveredImportedTrackId = useMapStore((s: MapStoreState) => s.setHoveredImportedTrackId);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);

	const polylinesRef = useRef<Map<string, { poly: L.Polyline; color: string }>>(new Map());
	/** One shared canvas renderer for every imported track: huge recorded
	 *  hikes as SVG paths make every hover restyle and zoom reproject the
	 *  whole DOM path; canvas redraws are an order of magnitude cheaper. */
	const rendererRef = useRef<L.Canvas | null>(null);
	const tooltipRef = useRef<L.Tooltip | null>(null);
	// Keep enhancedTrailPoints in a ref so mousemove handlers always see the latest value
	// without requiring polylines to be recreated on every trail-point update
	const enhancedTrailPointsRef = useRef(enhancedTrailPoints);
	const lastMoveRef = useRef(0);
	/** Trail spatial grid for the hover tooltip, built lazily on first
	 *  mousemove and rebuilt only when the trail changes. The previous
	 *  forward scan started at trail km 0 and bailed on the first divergence,
	 *  so hovering a track hundreds of km in reported the distance to the
	 *  trailhead (six-digit "m from trail" values). */
	const gridRef = useRef<{ grid: SpatialGrid; forLength: number } | null>(null);

	useEffect(() => {
		enhancedTrailPointsRef.current = enhancedTrailPoints;
	}, [enhancedTrailPoints]);

	useEffect(() => {
		const existing = polylinesRef.current;
		// Hidden tracks are torn down entirely (not just transparent), so they
		// cost nothing while hidden; re-showing rebuilds from the stored points.
		const wantedIds = new Set(importedTracks.filter((t) => t.visible !== false).map((t) => t.id));

		// Remove deleted and hidden tracks
		for (const [id, entry] of existing) {
			if (!wantedIds.has(id)) {
				entry.poly.remove();
				existing.delete(id);
			}
		}

		rendererRef.current ??= L.canvas({ padding: 0.3 });

		for (const track of importedTracks) {
			if (track.visible === false) continue;
			// Live color update without rebuild
			const present = existing.get(track.id);
			if (present) {
				if (present.color !== track.color) {
					present.poly.setStyle({ color: track.color });
					present.color = track.color;
				}
				continue;
			}
			const latlngs = track.points.map((p) => [p.lat, p.lng] as L.LatLngTuple);
			if (latlngs.length === 0) continue;

			const poly = L.polyline(latlngs, {
				color: track.color,
				weight: 3,
				opacity: 0.85,
				smoothFactor: 1.5,
				renderer: rendererRef.current,
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

				if (gridRef.current?.forLength !== pts.length) {
					gridRef.current = { grid: buildSpatialGrid(pts), forLength: pts.length };
				}
				const hit = gridRef.current.grid.nearest(e.latlng.lat, e.latlng.lng);
				if (!hit) return;

				// Unit-aware: meters/km in metric, feet/miles in imperial. Units
				// are read at event time so a toggle doesn't require rebinding.
				const currentUnits = useMapStore.getState().units;
				const formatted =
					currentUnits === 'imperial'
						? hit.distanceM * 3.28084 < 1000
							? `${Math.round(hit.distanceM * 3.28084)} ft`
							: `${kmToMiles(hit.distanceM / 1000).toFixed(1)} mi`
						: hit.distanceM < 1000
							? `${Math.round(hit.distanceM)} m`
							: `${(hit.distanceM / 1000).toFixed(1)} km`;
				const label = t('distanceFromTrail', { distance: formatted });
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
			existing.set(track.id, { poly, color: track.color });
		}
	}, [importedTracks, map, setHoveredImportedTrackId, t]);

	// Cleanup on unmount
	useEffect(() => {
		const polylines = polylinesRef.current;
		const tooltip = tooltipRef;
		return () => {
			for (const entry of polylines.values()) entry.poly.remove();
			polylines.clear();
			if (tooltip.current) {
				tooltip.current.remove();
				tooltip.current = null;
			}
		};
	}, []);

	return null;
}
