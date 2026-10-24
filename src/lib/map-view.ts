import type { LatLngExpression, Map as LeafletMap, ZoomPanOptions } from 'leaflet';

/**
 * `map.flyTo`, or an instant `setView` while the map has no size (a minimized
 * window, a hidden container). Leaflet scales the fly path by the container
 * size, so on a 0x0 map every animation frame computes NaN coordinates and
 * throws, which also aborts the caller before it finishes (a share link's
 * highlight, a POI popup). Use it for views opened from links on load; a user
 * tapping a control always has a sized map.
 *
 * `onMoveEnd` runs once when this move ends. The fly registers it after
 * starting, because flyTo first stops any running pan, which fires moveend;
 * the instant path fires moveend synchronously, so it registers first.
 */
export function flyToOrSetView(
	map: LeafletMap,
	center: LatLngExpression,
	zoom?: number,
	options?: ZoomPanOptions,
	onMoveEnd?: () => void,
): void {
	const size = map.getSize();
	if (size.x > 0 && size.y > 0) {
		map.flyTo(center, zoom, options);
		if (onMoveEnd) map.once('moveend', onMoveEnd);
		return;
	}
	if (onMoveEnd) map.once('moveend', onMoveEnd);
	map.setView(center, zoom ?? map.getZoom(), { animate: false });
}
