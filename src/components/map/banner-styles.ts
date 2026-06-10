/**
 * Shared classes for the top-of-map alert banner stack (trail notices,
 * severe weather, seasonal status, off-route). One source of truth so the
 * banners cannot drift apart visually.
 */
export const BANNER_REGION_CLASSES = 'relative z-[var(--z-banner)]';
export const BANNER_ROW_CLASSES = 'flex items-start gap-2 px-3 py-2 text-sm';
/** Solid red severity coloring (emergency-grade banners). */
export const BANNER_RED_CLASSES = 'bg-cldt-red text-white';
