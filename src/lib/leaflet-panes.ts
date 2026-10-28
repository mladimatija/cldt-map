import type L from 'leaflet';

/** True for Leaflet's default tile pane, which holds the base map layer (and the
 *  clipped copy MapControls builds from it); overlays set a pane of their own. */
export function isBaseTilePane(pane: string | undefined): boolean {
	return pane === undefined || pane === 'tilePane';
}

export interface EnsurePaneOptions {
	/** Class on the pane element; the stacking rules live in map.css. */
	className?: string;
	/** Insert the pane in front of this built-in pane. The app flattens pane
	 *  z-index, so for these panes document order decides the stacking. */
	before?: 'markerPane' | 'overlayPane';
	/** Inline styles set once, when the pane is created. */
	style?: Partial<Pick<CSSStyleDeclaration, 'mixBlendMode' | 'zIndex'>>;
}

/**
 * Returns the named map pane, creating it on first use. Layers and their
 * components mount more than once (a remount, React's dev double effect), and a
 * second createPane under the same name would replace the pane Leaflet tracks
 * while the first element stays in the DOM.
 */
export function ensurePane(
	map: L.Map,
	name: string,
	{ className, before, style }: EnsurePaneOptions = {},
): HTMLElement {
	const existing = map.getPane(name);
	if (existing) return existing;
	const pane = map.createPane(name);
	if (className) pane.classList.add(className);
	if (style) Object.assign(pane.style, style);
	if (before) {
		const reference = map.getPane(before);
		reference?.parentNode?.insertBefore(pane, reference);
	}
	return pane;
}
