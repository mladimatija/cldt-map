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

/** Builds a minimal GPX 1.1 XML string from an array of track points. */
export function buildGpxXml(points: GpxExportPoint[], trackName: string): string {
	const trackPoints = points
		.map((p) => {
			const ele = p.elevation !== undefined ? `\n\t\t\t<ele>${p.elevation.toFixed(1)}</ele>` : '';
			return `\t\t<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">${ele}\n\t\t</trkpt>`;
		})
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="CLDT Map - map.cldt.hr" xmlns="http://www.topografix.com/GPX/1/1">
\t<trk>
\t\t<name>${escapeXml(trackName)}</name>
\t\t<trkseg>
${trackPoints}
\t\t</trkseg>
\t</trk>
</gpx>`;
}

/**
 * Extracts a contiguous slice of track points from a raw GPX XML string by
 * index range and wraps them in a new minimal GPX 1.1 document.
 *
 * Uses string splitting on `<trkpt` to avoid a full DOM parse - the raw GPX
 * from the proxy is well-formed and consistent, so this is both fast and safe.
 */
export function extractGpxSegment(rawGpxXml: string, startIndex: number, endIndex: number, trackName: string): string {
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

	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="CLDT Map - map.cldt.hr" xmlns="http://www.topografix.com/GPX/1/1">
\t<trk>
\t\t<name>${escapeXml(trackName)}</name>
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

/** Triggers a browser file download for the given GPX content. */
export function downloadGpxFile(gpxContent: string, filename: string): void {
	const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
