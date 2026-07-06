export interface GpxExportPoint {
	lat: number;
	lng: number;
	elevation?: number;
}

/** XML-escape attribute / text content. The dataset is curated but we don't
 *  trust that to mean it never contains `&` or `<` (Wikipedia titles do). */
function escapeXml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * Optional GPX document metadata. All strings are already formatted and
 * translated by the caller - this module stays app-agnostic (no i18n, no
 * formatters). `trackDesc` renders as `<trk><desc>`; the rest render inside a
 * `<metadata>` block.
 */
export interface GpxDocMeta {
	name?: string;
	desc?: string;
	link?: string;
	time?: string;
	trackDesc?: string;
}

/**
 * Renders a GPX 1.1 `<metadata>` block from the provided fields. Element order
 * follows the GPX 1.1 schema (name, desc, link, time) so the output validates.
 * Returns an empty string when no metadata fields are set.
 */
function buildMetadataBlock(meta: GpxDocMeta): string {
	const lines: string[] = [];
	if (meta.name) lines.push(`\t\t<name>${escapeXml(meta.name)}</name>`);
	if (meta.desc) lines.push(`\t\t<desc>${escapeXml(meta.desc)}</desc>`);
	if (meta.link) lines.push(`\t\t<link href="${escapeXml(meta.link)}" />`);
	if (meta.time) lines.push(`\t\t<time>${escapeXml(meta.time)}</time>`);
	if (lines.length === 0) return '';
	return `\t<metadata>\n${lines.join('\n')}\n\t</metadata>\n`;
}

/** `<trk><desc>` line (leading newline included) or '' when unset. */
function trackDescLine(meta?: GpxDocMeta): string {
	return meta?.trackDesc ? `\n\t\t<desc>${escapeXml(meta.trackDesc)}</desc>` : '';
}

/** Builds a minimal GPX 1.1 XML string from an array of track points. */
export function buildGpxXml(points: GpxExportPoint[], trackName: string, meta?: GpxDocMeta): string {
	const trackPoints = points
		.map((p) => {
			const ele = p.elevation !== undefined ? `\n\t\t\t<ele>${p.elevation.toFixed(1)}</ele>` : '';
			return `\t\t<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">${ele}\n\t\t</trkpt>`;
		})
		.join('\n');

	const metadataBlock = meta ? buildMetadataBlock(meta) : '';

	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="CLDT Map - map.cldt.hr" xmlns="http://www.topografix.com/GPX/1/1">
${metadataBlock}\t<trk>
\t\t<name>${escapeXml(trackName)}</name>${trackDescLine(meta)}
\t\t<trkseg>
${trackPoints}
\t\t</trkseg>
\t</trk>
</gpx>`;
}

/**
 * Splices a `<metadata>` block into an existing GPX document immediately after
 * the opening `<gpx ...>` tag. Used by the full-trail export, which passes the
 * upstream GPX through verbatim apart from this injection. Returns the input
 * unchanged when the open tag can't be located, when meta yields no fields, or
 * when the document already carries a `<metadata>` element (a second one would
 * be schema-invalid).
 */
export function injectGpxMetadata(rawXml: string, meta: GpxDocMeta): string {
	const block = buildMetadataBlock(meta);
	if (!block) return rawXml;
	if (/<metadata[\s>]/.test(rawXml)) return rawXml;
	const openMatch = rawXml.match(/<gpx\b[^>]*>/);
	if (openMatch?.index === undefined) return rawXml;
	const insertAt = openMatch.index + openMatch[0].length;
	// `block` ends with a newline; drop it so the following content keeps its
	// original leading newline instead of gaining a blank line.
	return `${rawXml.slice(0, insertAt)}\n${block.replace(/\n$/, '')}${rawXml.slice(insertAt)}`;
}

/**
 * Extracts a contiguous slice of track points from a raw GPX XML string by
 * index range and wraps them in a new minimal GPX 1.1 document.
 *
 * Uses string splitting on `<trkpt` to avoid a full DOM parse - the raw GPX
 * from the proxy is well-formed and consistent, so this is both fast and safe.
 */
export function extractGpxSegment(
	rawGpxXml: string,
	startIndex: number,
	endIndex: number,
	trackName: string,
	meta?: GpxDocMeta,
): string {
	// parts[0] = content before the first <trkpt
	// parts[i+1] = content starting after the i-th '<trkpt' opening tag token
	const parts = rawGpxXml.split('<trkpt');
	const segmentParts = parts.slice(startIndex + 1, endIndex + 2);
	if (segmentParts.length === 0) return '';

	// The last part may contain trailing XML (</trkseg></trk></gpx>); trim to </trkpt>.
	const last = segmentParts[segmentParts.length - 1];
	const closingIdx = last.indexOf('</trkpt>');
	if (closingIdx !== -1) {
		segmentParts[segmentParts.length - 1] = last.slice(0, closingIdx + '</trkpt>'.length) + '\n';
	}

	const trackPoints = segmentParts.map((s) => '\t\t\t<trkpt' + s).join('');
	const metadataBlock = meta ? buildMetadataBlock(meta) : '';

	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="CLDT Map - map.cldt.hr" xmlns="http://www.topografix.com/GPX/1/1">
${metadataBlock}\t<trk>
\t\t<name>${escapeXml(trackName)}</name>${trackDescLine(meta)}
\t\t<trkseg>
${trackPoints}\t\t</trkseg>
\t</trk>
</gpx>`;
}

export interface GpxWaypoint {
	lat: number;
	lng: number;
	name: string;
	/** OSMAnd / generic POI type label - rendered into <type> for waypoint
	 *  categorisation. */
	type?: string;
	/** Optional metres. Skipped when missing rather than rendered as 0. */
	elevation?: number;
	/** Optional free-text description shown when the user taps the waypoint. */
	description?: string;
	/** GPX 1.1 `<sym>` - symbol name for GPS apps that render icons from sym. */
	sym?: string;
	/** Optional canonical URL associated with the POI. */
	url?: string;
}

/**
 * Builds a GPX 1.1 document that contains only `<wpt>` elements, no tracks.
 * Output is OSMAnd / Locus / Gaia-compatible: each waypoint carries name,
 * optional elevation, type, description, and link. Use this when the user
 * has cherry-picked a set of POIs for offline import to a GPS app.
 */
export function buildGpxWaypointXml(waypoints: GpxWaypoint[], documentName: string): string {
	const wpts = waypoints
		.map((w) => {
			const parts: string[] = [`\t<wpt lat="${w.lat.toFixed(7)}" lon="${w.lng.toFixed(7)}">`];
			if (w.elevation !== undefined) parts.push(`\t\t<ele>${w.elevation.toFixed(1)}</ele>`);
			parts.push(`\t\t<name>${escapeXml(w.name)}</name>`);
			if (w.description) parts.push(`\t\t<desc>${escapeXml(w.description)}</desc>`);
			if (w.url) parts.push(`\t\t<link href="${escapeXml(w.url)}" />`);
			if (w.type) parts.push(`\t\t<type>${escapeXml(w.type)}</type>`);
			if (w.sym) parts.push(`\t\t<sym>${escapeXml(w.sym)}</sym>`);
			parts.push('\t</wpt>');
			return parts.join('\n');
		})
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="CLDT Map - map.cldt.hr" xmlns="http://www.topografix.com/GPX/1/1">
\t<metadata>
\t\t<name>${escapeXml(documentName)}</name>
\t</metadata>
${wpts}
</gpx>`;
}

/**
 * Triggers a browser file download for arbitrary content. Revokes the object
 * URL on a short delay because Safari needs it alive until the click is
 * processed. Shared by every file-export path.
 */
export function downloadBlob(content: BlobPart, filename: string, mime: string): void {
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Triggers a browser file download for the given GPX content. */
export function downloadGpxFile(gpxContent: string, filename: string): void {
	downloadBlob(gpxContent, filename, 'application/gpx+xml');
}

const GPX_MIME = 'application/gpx+xml';

/**
 * Chromium ShareServiceImpl (desktop Mac/Win, ChromeOS, Android Chrome) rejects
 * GPX at share() via a fixed MIME/extension allowlist. Blink canShare() does not
 * apply that check, so it can return true for GPX even though share() fails.
 */
function usesChromiumWebShareFileAllowlist(): boolean {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent;
	// iOS browsers (including CriOS) use WebKit sharing, not Chromium's allowlist.
	if (/iPhone|iPad|iPod/.test(ua)) return false;
	if (/Android/.test(ua)) return /Chrome\//.test(ua);
	// Desktop Chromium forks (Chrome, Edge, Opera). Safari uses WebKit sharing.
	if (/Edg\//.test(ua) || /OPR\//.test(ua)) return true;
	if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return true;
	return false;
}

/** True when the Web Share API can hand a GPX file to another app (OsmAnd,
 *  Locus, Gaia, mail, ...) - the mobile share-sheet path. */
export function canShareGpxFiles(): boolean {
	if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
	if (usesChromiumWebShareFileAllowlist()) return false;
	try {
		const probe = new File(['<gpx/>'], 'probe.gpx', { type: GPX_MIME });
		return navigator.canShare({ files: [probe] });
	} catch {
		return false;
	}
}

/**
 * Opens the platform share sheet with the GPX as a file attachment. Must be
 * called from a user-gesture handler. Resolves true when the share sheet was
 * opened (a user cancel still counts as handled); false means unsupported or
 * rejected.
 */
export async function shareGpxFile(gpxContent: string, filename: string, title?: string): Promise<boolean> {
	if (!canShareGpxFiles()) return false;
	const file = new File([gpxContent], filename, { type: GPX_MIME });
	try {
		await navigator.share({ files: [file], title: title ?? filename });
		return true;
	} catch (err) {
		// AbortError = user dismissed the sheet; that is a handled outcome.
		return err instanceof Error && err.name === 'AbortError';
	}
}
