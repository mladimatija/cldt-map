/**
 * Shared classes for the top-of-map alert banner stack (trail notices,
 * severe weather, seasonal status, off-route). One source of truth so the
 * banners cannot drift apart visually.
 */
export const BANNER_REGION_CLASSES = 'relative z-[var(--z-banner)]';
/** Centred, so the 44 px close button lines up with the text instead of hanging below it. */
export const BANNER_ROW_CLASSES = 'flex items-center gap-2 px-3 py-2 text-sm';
/** Pale amber for informational banners (e.g. stale seasonal data). */
export const BANNER_INFO_CLASSES = 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200';
/** Solid red severity coloring (emergency-grade banners). */
export const BANNER_RED_CLASSES = 'bg-cldt-red text-white';
/** Top-center compact chip (OfflineIndicator, DemoBanner). */
export const COMPACT_BANNER_CHIP_CLASSES =
	'map-tooltip map-tooltip--banner map-tooltip--compact animate-slide-in-from-top flex items-center justify-center gap-1.5 motion-reduce:animate-none';
