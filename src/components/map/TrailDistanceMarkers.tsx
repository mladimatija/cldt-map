'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import {
	computeDistanceMarkers,
	isLevelVisibleAtZoom,
	DISTANCE_MARKER_LEVELS,
	type DistanceMarker,
	type DistanceMarkerLevel,
} from '@/lib/distance-markers';
import type { UnitSystem } from '@/lib/types';

/** Dedicated pane so distance markers render above the seasonal-status halo
 *  (z-map+1) but below the chip-marker pane, trail-point-marker pane, and
 *  every tooltip pane (all at z-map-tooltips or higher). */
const DISTANCE_MARKER_PANE = 'trailDistanceMarkerPane';

/** Battery-saver caps the active levels to the lowest-density set (100/50/25/10).
 *  Levels 5 and 1 generate the bulk of the DOM at zoom 11+ and 13+ - skipping
 *  them keeps the marker count under ~400 on constrained devices. */
const BATTERY_SAVER_LEVELS: ReadonlySet<DistanceMarkerLevel> = new Set([100, 50, 25, 10]);

function unitSuffix(units: UnitSystem): string {
	return units === 'imperial' ? 'mi' : 'km';
}

function buildIcon(marker: DistanceMarker, units: UnitSystem): L.DivIcon {
	const label = escapeHtml(marker.label);
	const aria = escapeHtml(`${marker.label} ${unitSuffix(units)}`);
	return L.divIcon({
		className: 'distance-marker-wrapper',
		html: `<span class="distance-marker distance-marker--${marker.level}" aria-label="${aria}">${label}</span>`,
		iconSize: [0, 0], // anchor only; visible bubble sizes itself via CSS
		iconAnchor: [0, 0],
	});
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Renders zoom-aware distance markers (1 / 5 / 10 / 25 / 50 / 100 unit
 * intervals) along the trail. Per-level LayerGroups are added to / removed
 * from the map as the zoom crosses each level's visibility threshold, so the
 * DOM only carries markers that are actually visible. Battery-saver mode
 * suppresses the two densest levels (1 and 5) entirely.
 */
export function TrailDistanceMarkers(): null {
	const map = useMap();
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);
	const showDistanceMarkers = useMapStore((s: MapStoreState) => s.showDistanceMarkers);
	const units = useMapStore((s: MapStoreState) => s.units);
	const batterySaverMode = useMapStore((s: MapStoreState) => s.batterySaverMode);

	const markers = useMemo(() => computeDistanceMarkers(enhancedTrailPoints, units), [enhancedTrailPoints, units]);

	const groupsRef = useRef<Map<DistanceMarkerLevel, L.LayerGroup>>(new Map());
	const mountedLevelsRef = useRef<Set<DistanceMarkerLevel>>(new Set());

	// Create the pane once; z-index is set in map.css.
	useEffect(() => {
		if (!map.getPane(DISTANCE_MARKER_PANE)) {
			map.createPane(DISTANCE_MARKER_PANE);
			map.getPane(DISTANCE_MARKER_PANE)?.classList.add('trail-distance-marker-pane');
		}
	}, [map]);

	// Build per-level LayerGroups whenever the marker set or units change.
	// Groups are constructed but not added to the map until applyZoomMembership
	// decides which levels belong at the current zoom.
	useEffect(() => {
		// Tear down whatever's currently on the map and rebuild from scratch.
		for (const group of groupsRef.current.values()) {
			map.removeLayer(group);
		}
		groupsRef.current = new Map();
		mountedLevelsRef.current = new Set();

		if (!showDistanceMarkers || markers.length === 0) return;

		const byLevel = new Map<DistanceMarkerLevel, L.Marker[]>();
		for (const m of markers) {
			if (batterySaverMode && !BATTERY_SAVER_LEVELS.has(m.level)) continue;
			const lm = L.marker([m.lat, m.lng], {
				icon: buildIcon(m, units),
				pane: DISTANCE_MARKER_PANE,
				interactive: false,
				keyboard: false,
			});
			const arr = byLevel.get(m.level) ?? [];
			arr.push(lm);
			byLevel.set(m.level, arr);
		}

		for (const level of DISTANCE_MARKER_LEVELS) {
			const layers = byLevel.get(level);
			if (!layers || layers.length === 0) continue;
			groupsRef.current.set(level, L.layerGroup(layers));
		}

		applyZoomMembership(map.getZoom(), map, groupsRef.current, mountedLevelsRef.current);

		return () => {
			for (const group of groupsRef.current.values()) {
				map.removeLayer(group);
			}
			groupsRef.current = new Map();
			mountedLevelsRef.current = new Set();
		};
	}, [map, markers, showDistanceMarkers, units, batterySaverMode]);

	useEffect(() => {
		if (!showDistanceMarkers) return;
		const onZoom = (): void => {
			applyZoomMembership(map.getZoom(), map, groupsRef.current, mountedLevelsRef.current);
		};
		map.on('zoomend', onZoom);
		return () => {
			map.off('zoomend', onZoom);
		};
	}, [map, showDistanceMarkers]);

	return null;
}

function applyZoomMembership(
	zoom: number,
	map: L.Map,
	groups: Map<DistanceMarkerLevel, L.LayerGroup>,
	mounted: Set<DistanceMarkerLevel>,
): void {
	for (const [level, group] of groups) {
		const shouldBeVisible = isLevelVisibleAtZoom(level, zoom);
		const isMounted = mounted.has(level);
		if (shouldBeVisible && !isMounted) {
			group.addTo(map);
			mounted.add(level);
		} else if (!shouldBeVisible && isMounted) {
			map.removeLayer(group);
			mounted.delete(level);
		}
	}
}
