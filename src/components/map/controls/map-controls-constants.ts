/** Distance precision slider range (0–3 decimal places). Value comes from config.distancePrecision / store. */
export const DISTANCE_PRECISION_MIN = 0;
export const DISTANCE_PRECISION_MAX = 3;

/** Shared class for round control buttons (inactive state). */
export const CONTROL_BTN_BASE =
	'flex h-10 w-10 items-center justify-center rounded-full shadow-md transition-all outline-none';
export const CONTROL_BTN_INACTIVE =
	'text-cldt-blue hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green cursor-pointer border border-gray-200 bg-white hover:border-2 focus-visible:border-2';
export const CONTROL_BTN_ACTIVE =
	'border-cldt-blue text-cldt-blue hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green cursor-pointer border-2 bg-white hover:border-2 focus-visible:border-2';

/** Popover/bar container: used by share panel, go-to-distance bar, etc. Uses z-controls-popover so base.css dark overrides apply. */
export const MAP_CONTROL_POPOVER =
	'z-controls-popover rounded-lg border border-gray-200 bg-white p-3 shadow-md dark:border-gray-600 dark:bg-gray-800';

/** Outline primary action (e.g., Copy a link, Go). Dark border overridden in map.css for .map-control-btn-outline. */
export const MAP_CONTROL_BTN_OUTLINE =
	'map-control-btn-outline dark:bg-transparent dark:text-white dark:hover:text-cldt-green text-cldt-blue hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green focus-visible:ring-cldt-green cursor-pointer rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium transition-all outline-none focus-visible:ring-1';

/** Outline secondary (e.g. Cancel). */
export const MAP_CONTROL_BTN_OUTLINE_SECONDARY =
	'focus-visible:border-cldt-green focus-visible:ring-cldt-green cursor-pointer rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-all outline-none hover:border-gray-300 hover:text-gray-900 focus-visible:ring-1 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:border-gray-500 dark:hover:bg-gray-600';

/** Inline input matching map control styling; dark mode: white text and border for GoToDistance. */
export const MAP_CONTROL_INPUT =
	'w-20 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm outline-none focus-visible:border-cldt-green focus-visible:ring-1 focus-visible:ring-cldt-green dark:border-white dark:bg-[var(--bg-secondary)] dark:text-white dark:placeholder-gray-400';
