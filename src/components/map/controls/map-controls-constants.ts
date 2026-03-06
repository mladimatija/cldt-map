/** Distance precision slider range (0–3 decimal places). Value comes from config.distancePrecision / store. */
export const DISTANCE_PRECISION_MIN = 0;
export const DISTANCE_PRECISION_MAX = 3;

/** Popover/bar container: used by share panel, go-to-distance bar, etc. Uses z-controls-popover so base.css dark overrides apply. */
export const MAP_CONTROL_POPOVER =
	'z-controls-popover rounded-lg border border-gray-200 bg-white p-3 shadow-md dark:border-gray-600 dark:bg-gray-800';

/** Inline input matching map control styling; dark mode: white text and border for GoToDistance. */
export const MAP_CONTROL_INPUT =
	'w-20 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm outline-none focus-visible:border-cldt-green focus-visible:ring-1 focus-visible:ring-cldt-green dark:border-white dark:bg-[var(--bg-secondary)] dark:text-white dark:placeholder-gray-400';
