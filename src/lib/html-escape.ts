/** Escapes text for HTML element content and double-quoted attribute values
 *  (marker and popup HTML built as strings, the trip-brief document). */
export function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes text for XML element content and attribute values in either quote
 *  style (GPX exports). */
export function escapeXml(value: string): string {
	return escapeHtml(value).replace(/'/g, '&apos;');
}
