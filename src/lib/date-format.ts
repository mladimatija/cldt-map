/**
 * Format an ISO date string for display using locale-appropriate formatting.
 * Uses en-GB for English to produce "1 June 2026" rather than "June 1, 2026".
 * Falls back to the ISO string if Intl support is missing.
 */
export function formatIsoDate(iso: string, locale: string): string {
	try {
		const d = new Date(iso);
		const tag = locale === 'en' ? 'en-GB' : locale;
		return d.toLocaleDateString(tag, { year: 'numeric', month: 'long', day: 'numeric' });
	} catch {
		return iso;
	}
}

/**
 * Compact localised day label like "Mon 17 Jun" for stage-plan calendar rows.
 * Anchors at midday so a yyyy-mm-dd string never slips a day across time zones.
 * Falls back to the ISO string if Intl support is missing.
 */
export function formatShortWeekdayDate(iso: string, locale: string): string {
	try {
		const d = new Date(`${iso}T12:00:00`);
		const tag = locale === 'en' ? 'en-GB' : locale;
		return d.toLocaleDateString(tag, { weekday: 'short', day: 'numeric', month: 'short' });
	} catch {
		return iso;
	}
}
