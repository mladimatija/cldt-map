/** Distance precision slider range (0-3 decimal places). Value comes from config.distancePrecision / store. */
export const DISTANCE_PRECISION_MIN = 0;
export const DISTANCE_PRECISION_MAX = 3;

/** Fixed right-side control panel width (Progress, Stage Planner, Settings).
 *  The min-width floor is clamped to the viewport so a larger UI text scale
 *  (rem-based widths grow with the root font) can never push the panel wider
 *  than a narrow phone screen. */
export const MAP_CONTROL_PANEL_WIDTH = 'w-[min(100vw-5rem,28rem)] max-w-md min-w-[min(20rem,100vw-2.5rem)]';

/** Popover/bar container: used by share panel and other map control popovers. Uses z-controls-popover so base.css dark overrides apply. */
export const MAP_CONTROL_POPOVER =
	'z-controls-popover rounded-lg border border-gray-200 bg-white p-3 shadow-md dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)]';

/** Inline input matching map control styling; dark mode: white text and border. */
export const MAP_CONTROL_INPUT =
	'w-20 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm outline-none focus-visible:border-cldt-green focus-visible:ring-1 focus-visible:ring-cldt-green dark:border-white dark:bg-[var(--bg-secondary)] dark:text-white dark:placeholder-[var(--text-secondary)]';

/** Label + numeric input + unit rows (settings pack weight, etc.). */
export const MAP_CONTROL_LABEL_INPUT_GRID = 'grid grid-cols-[minmax(0,1fr)_6rem_3.5rem] items-center gap-x-2 gap-y-1.5';

/** Link-style button for deep-link rows (Help "Start here" launcher, stage-plan
 *  presets). Compose per-instance layout (flex/width/truncate) via cn(). */
export const MAP_CONTROL_LINK_BUTTON =
	'text-cldt-blue hover:text-cldt-green focus-visible:ring-cldt-green cursor-pointer rounded border-0 bg-transparent p-1 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-offset-1';

/** Section divider: top border + padding between modal/panel sections. */
export const MAP_CONTROL_SECTION_DIVIDER = 'border-t border-gray-200 pt-3 dark:border-[var(--border-color)]';

/**
 * Shared dark-mode class fragments - keep in sync with theme.css .dark variables.
 */
/** Dark panel background + border (panels, popovers, modals). */
export const DARK_PANEL = 'dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)]';
/** Dark primary text. */
export const DARK_TEXT = 'dark:text-[var(--text-primary)]';
/** Dark muted/secondary text (descriptions, hints, labels). */
export const DARK_TEXT_MUTED = 'dark:text-[var(--text-secondary)]';
