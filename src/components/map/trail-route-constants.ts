import L from 'leaflet';

/** Default polyline style for the trail route. */
export const DEFAULT_PATH_OPTIONS: L.PathOptions = {
	color: '#e1584d',
	weight: 5,
	opacity: 0.8,
};

/** Meters – snap to exact start/end when within this. */
export const TRAIL_EPSILON_M = 10;

/** Estimated tooltip size for positioning. */
export const TOOLTIP_EST_WIDTH = 280;
export const TOOLTIP_EST_HEIGHT = 280;
export const TOOLTIP_PADDING = 12;

/** Start (direction) flag icon SVG. */
export const START_FLAG_SVG =
	'<svg viewBox="0 0 512 512" width="16" height="16" fill="none" stroke="white" stroke-width="32" stroke-linecap="round" stroke-miterlimit="10"><path d="M80 464V68.14a8 8 0 0 1 4-6.9C91.81 56.66 112.92 48 160 48c64 0 145 48 192 48a199.53 199.53 0 0 0 77.23-15.77 2 2 0 0 1 2.77 1.85v219.36a4 4 0 0 1-2.39 3.65C421.37 308.7 392.33 320 352 320c-48 0-128-32-192-32s-80 16-80 16"/></svg>';

/** Finish flag icon SVG. */
export const FINISH_FLAG_SVG =
	'<svg viewBox="0 0 512 512" width="16" height="16" fill="white"><path d="M80 480a16 16 0 0 1-16-16V68.13a24 24 0 0 1 11.9-20.72C88 40.38 112.38 32 160 32c37.21 0 78.83 14.71 115.55 27.68C305.12 70.13 333.05 80 352 80a183.84 183.84 0 0 0 71-14.5 18 18 0 0 1 25 16.58v219.36a20 20 0 0 1-12 18.31c-8.71 3.81-40.51 16.25-84 16.25-24.14 0-54.38-7.14-86.39-14.71C229.63 312.79 192.43 304 160 304c-36.87 0-55.74 5.58-64 9.11V464a16 16 0 0 1-16 16z"/></svg>';

/** Returns a DivIcon for a section boundary marker with the section label and color. */
export function sectionBoundaryIcon(label: string, color: string): L.DivIcon {
	return L.divIcon({
		className: 'trail-section-marker',
		html: `<div class="trail-section-marker-inner" style="background-color:${color};">${label}</div>`,
		iconSize: [24, 24],
		iconAnchor: [12, 12],
	});
}
