/** Guards for values from external data before they reach links, dial URIs or
 *  regular expressions. */

/**
 * Returns true when the URL is an absolute http(s) URL. Used to gate anchors whose
 * href comes from external data (notices feed, HGSS dataset) so a malicious
 * javascript:/data: payload cannot execute via the link. Relative paths and
 * non-http(s) schemes are rejected.
 */
export function isSafeUrl(u: string | undefined | null): u is string {
	if (!u) return false;
	try {
		const protocol = new URL(u).protocol;
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

/** Phone shapes safe to turn into a tel:/sms: link (mirrors the POI popup / HGSS guard). */
export const LINKABLE_PHONE_RE = /^\+?[\d\s().,-]{1,30}$/;

/**
 * Reduce a (LINKABLE_PHONE_RE-valid) phone to a tel:/sms: dial string: digits with
 * at most a single leading '+'. Drops formatting characters that could otherwise
 * inject extra sms: URI parameters, and collapses stray inner '+' signs.
 */
export function toDialString(phone: string): string {
	const cleaned = phone.replace(/[^\d+]/g, '');
	const digits = cleaned.replace(/\+/g, '');
	return cleaned.startsWith('+') ? `+${digits}` : digits;
}

/**
 * Escape a string for safe interpolation into a RegExp source. Use before
 * `new RegExp(...)` whenever the pattern is built from a value that could be
 * influenced by external input.
 */
export function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
