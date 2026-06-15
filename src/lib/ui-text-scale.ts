/**
 * UI text-size accessibility setting.
 *
 * Three discrete levels, all at or above the base size (the accessibility intent
 * is readability, and a smaller level would shrink the already-tiny rem-converted
 * micro-text like text-[0.625rem] further rather than help). 'default' is the
 * base 16px document-root font set in base.css; 'large'/'larger' add a class to
 * <html> that raises the root font-size (18 / 20px). Because the control panels'
 * text is expressed in rem-relative Tailwind utilities (text-xs/sm plus the
 * rem-converted micro-text), every UI text size follows the root font and scales
 * together. Map-canvas annotations (distance markers, tooltips) keep their own
 * fixed px sizes, and the viewport-sized map container is never resized.
 *
 * Dependency-free on purpose: imported by config, the store, ThemeProvider, and
 * the settings panel without risking an import cycle.
 */

export const UI_TEXT_SCALES = ['default', 'large', 'larger'] as const;
export type UiTextScale = (typeof UI_TEXT_SCALES)[number];

/** Root <html> class for a scale, or null for the default (unscaled) level. */
export function uiTextScaleClass(scale: UiTextScale): string | null {
	return scale === 'default' ? null : `ui-scale-${scale}`;
}

/** Runtime guard for persisted or env-provided values. */
export function isUiTextScale(value: unknown): value is UiTextScale {
	return typeof value === 'string' && (UI_TEXT_SCALES as readonly string[]).includes(value);
}
