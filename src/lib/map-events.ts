/** Custom event name for toggling map fullscreen. MapWrapper listens and handles with its ref. */
export const MAP_FULLSCREEN_TOGGLE_EVENT = 'toggleMapFullscreen';

export function dispatchMapFullscreenToggle(): void {
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(MAP_FULLSCREEN_TOGGLE_EVENT));
	}
}
