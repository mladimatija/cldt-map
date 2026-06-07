/**
 * POI marker primitives - constants, type-keyed style maps, the icon factories,
 * and the pixel-grid clustering. Extracted from PoiMarkers.tsx so the component
 * file stays focused on Leaflet effects, popups, and React-store wiring; the
 * pieces here are pure (no React, no store, no DOM mutation outside the
 * returned Leaflet objects).
 */

import L from 'leaflet';
import type { Poi } from '@/lib/pois';

/** Zoom level at and above which clustering is disabled. Below this, nearby
 *  POIs are grouped into a single count-bearing marker; at this zoom or
 *  higher, every POI renders individually. 12 is a city-scale zoom where
 *  hikers want to see all the food / ATM / hut details. */
export const CLUSTER_MAX_ZOOM = 12;

/** Grid cell edge length in pixels at the current zoom. Cells smaller than
 *  this cluster together; ~60 px keeps cluster discs from overlapping each
 *  other while still aggregating dense areas. */
export const CLUSTER_CELL_PX = 60;

/** Touch-friendly tap target around every POI marker. The visible dot stays at
 *  the small per-type `size` (so dense clusters stay legible), but Leaflet
 *  allocates a 44x44 transparent wrapper around it. The dot is centred via flex in
 *  `.poi-marker-wrapper`. */
export const POI_TAP_TARGET = 44;

/** Per-type marker disc size. Bigger types are higher-priority info: a town
 *  matters more at country zoom than a single ATM. Open dictionary so future
 *  types only need to add a size entry. */
export const TYPE_SIZE: Record<string, number> = {
	town: 18,
	settlement: 15,
	peak: 15,
	viewpoint: 14,
	hut: 16,
	shelter: 15,
	restaurant: 13,
	cafe: 13,
	food: 13,
	atm: 13,
};

/** Per-type fill colours, resolved via CSS custom properties defined in
 *  `theme.css`. Each known type maps to a `var(--poi-color-<type>)` reference
 *  so light / dark palettes live in one file and a future palette change is a
 *  CSS-only edit. Unknown types fall back to `var(--poi-color-default)`. */
export const TYPE_COLOR: Record<string, string> = {
	town: 'var(--poi-color-town)',
	settlement: 'var(--poi-color-settlement)',
	peak: 'var(--poi-color-peak)',
	viewpoint: 'var(--poi-color-viewpoint)',
	hut: 'var(--poi-color-hut)',
	shelter: 'var(--poi-color-shelter)',
	restaurant: 'var(--poi-color-restaurant)',
	cafe: 'var(--poi-color-cafe)',
	food: 'var(--poi-color-food)',
	atm: 'var(--poi-color-atm)',
};

/** Escape HTML special characters for use in element text or attribute
 *  values. Shared with the popup builders in PoiMarkers since every dynamic
 *  string injected into Leaflet's innerHTML must pass through this. */
export function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Build a Leaflet divIcon for a single POI. */
export function buildIcon(poi: Poi, ariaLabel: string): L.DivIcon {
	const size = TYPE_SIZE[poi.type] ?? 8;
	const color = TYPE_COLOR[poi.type] ?? 'var(--poi-color-default)';
	const safeLabel = escapeHtml(ariaLabel);
	return L.divIcon({
		className: 'poi-marker-wrapper',
		html:
			`<span class="poi-marker poi-marker--${escapeHtml(poi.type)}" ` +
			`style="--poi-color:${color};--poi-size:${size}px" aria-label="${safeLabel}"></span>`,
		iconSize: [POI_TAP_TARGET, POI_TAP_TARGET],
		iconAnchor: [POI_TAP_TARGET / 2, POI_TAP_TARGET / 2],
	});
}

/** Lower clamp on the cluster disc size
 *  touch target floor. */
const CLUSTER_MIN_SIZE = 44;
/** Upper clamp on the cluster disc size - keeps the largest cluster from
 *  visually dominating individual markers. */
const CLUSTER_MAX_SIZE = 48;
/** Base size before the log-scaled count contribution is added. */
const CLUSTER_BASE_SIZE = 20;
/** Per-doubling-of-count growth in pixels (`log2(count) * factor`). */
const CLUSTER_LOG_SCALE = 6;

/** Cluster marker: a labelled disc showing the POI count for the cell.
 *  Size scales with count so a 50-POI cluster reads visually heavier than a
 *  2-POI cluster. */
export function buildClusterIcon(count: number, ariaLabel: string): L.DivIcon {
	const size = Math.max(
		CLUSTER_MIN_SIZE,
		Math.min(CLUSTER_MAX_SIZE, CLUSTER_BASE_SIZE + Math.round(Math.log2(count) * CLUSTER_LOG_SCALE)),
	);
	const safeLabel = escapeHtml(ariaLabel);
	return L.divIcon({
		className: 'poi-cluster-wrapper',
		html: `<span class="poi-cluster" style="--cluster-size:${size}px" aria-label="${safeLabel}">${count}</span>`,
		iconSize: [size, size],
		iconAnchor: [size / 2, size / 2],
	});
}

export interface PoiCluster {
	pois: Poi[];
	/** Centroid lat/lng for the cluster marker. */
	lat: number;
	lng: number;
}

/**
 * Buckets POIs into a pixel-space grid at the current zoom level and returns
 * one cluster per non-empty cell. Single-POI cells are emitted as
 * one-element clusters so the caller can render them as plain markers
 * without a separate code path. Centroid is the geometric mean of the
 * cell's POIs.
 */
export function clusterPois(pois: Poi[], map: L.Map, cellPx: number): PoiCluster[] {
	if (pois.length === 0) return [];
	const buckets = new Map<string, Poi[]>();
	for (const p of pois) {
		const pt = map.project([p.lat, p.lng], map.getZoom());
		const cellX = Math.floor(pt.x / cellPx);
		const cellY = Math.floor(pt.y / cellPx);
		const key = `${cellX},${cellY}`;
		const arr = buckets.get(key) ?? [];
		arr.push(p);
		buckets.set(key, arr);
	}
	const out: PoiCluster[] = [];
	for (const arr of buckets.values()) {
		const lat = arr.reduce((s, p) => s + p.lat, 0) / arr.length;
		const lng = arr.reduce((s, p) => s + p.lng, 0) / arr.length;
		out.push({ pois: arr, lat, lng });
	}
	return out;
}
