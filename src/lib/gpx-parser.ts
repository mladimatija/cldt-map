export interface TrackPoint {
	lat: number;
	lng: number;
	ele?: number;
	time?: Date;
}

export interface ParsedTrack {
	name?: string;
	points: TrackPoint[];
}

export interface ParsedGpx {
	tracks: ParsedTrack[];
}

/** Largest GPX accepted anywhere (trail load and user imports). Checked before
 *  DOMParser, which would otherwise allocate memory for the whole document. */
export const MAX_GPX_BYTES = 20 * 1024 * 1024;

/**
 * Regex-based trkpt extraction for the first <trk> of a GPX document.
 * DOMParser does not exist in workers or Node scripts; for the trail GPX
 * (machine-generated trkpt/ele markup) attribute-regex parsing is exact. The
 * same safety gates as parseGpx apply: size cap and DOCTYPE rejection.
 */
export function parseTrackPoints(xml: string): { lat: number; lng: number; ele?: number }[] {
	if (xml.length > MAX_GPX_BYTES) throw new Error('GPX file is too large');
	if (/<!DOCTYPE/i.test(xml)) throw new Error('GPX file contains unsupported DOCTYPE');

	// First <trk> scope only, mirroring `parsed.tracks[0]`.
	const trkMatch = /<trk[\s>][\s\S]*?<\/trk>/.exec(xml);
	const scope = trkMatch ? trkMatch[0] : xml;

	const points: { lat: number; lng: number; ele?: number }[] = [];
	const trkptRe = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*)\/>/g;
	let m: RegExpExecArray | null;
	while ((m = trkptRe.exec(scope)) !== null) {
		const attrs = m[1] ?? m[3] ?? '';
		const latMatch = /lat="([^"]+)"/.exec(attrs);
		const lonMatch = /lon="([^"]+)"/.exec(attrs);
		if (!latMatch || !lonMatch) continue;
		const lat = parseFloat(latMatch[1]);
		const lng = parseFloat(lonMatch[1]);
		if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
		const point: { lat: number; lng: number; ele?: number } = { lat, lng };
		const body = m[2] ?? '';
		const eleMatch = /<ele>([^<]+)<\/ele>/.exec(body);
		if (eleMatch) {
			const ele = parseFloat(eleMatch[1]);
			if (!Number.isNaN(ele)) point.ele = ele;
		}
		points.push(point);
	}
	return points;
}

export function parseGpx(xml: string): ParsedGpx {
	// Refuse to parse oversized files before they hit DOMParser, which would otherwise
	// allocate proportional memory for the entire document.
	if (xml.length > MAX_GPX_BYTES) throw new Error('GPX file is too large');

	// Reject DOCTYPE to prevent entity-expansion DoS (Billion Laughs)
	if (/<!DOCTYPE/i.test(xml)) throw new Error('GPX file contains unsupported DOCTYPE');

	const gpxDoc = new DOMParser().parseFromString(xml, 'text/xml');
	if (gpxDoc.querySelector('parsererror')) throw new Error('GPX file is malformed XML');

	const tracks = Array.from(gpxDoc.getElementsByTagName('trk')).map((trk) => {
		const nameEl = trk.getElementsByTagName('name')[0];
		const name = nameEl?.textContent?.trim() || undefined;

		const points = Array.from(trk.getElementsByTagName('trkpt')).flatMap((pt) => {
			const latAttr = pt.getAttribute('lat');
			const lonAttr = pt.getAttribute('lon');
			if (latAttr === null || lonAttr === null) return [];

			const lat = parseFloat(latAttr);
			const lng = parseFloat(lonAttr);
			if (isNaN(lat) || isNaN(lng)) return [];

			const point: TrackPoint = { lat, lng };

			const eleEl = pt.getElementsByTagName('ele')[0];
			if (eleEl?.textContent) {
				const ele = parseFloat(eleEl.textContent);
				if (!isNaN(ele)) point.ele = ele;
			}

			const timeEl = pt.getElementsByTagName('time')[0];
			if (timeEl?.textContent) {
				const timeStr = timeEl.textContent.trim();
				// ISO 8601 with timezone is at most 29 chars; reject longer strings
				// to avoid allocating the Date constructor for pathological inputs.
				if (timeStr.length <= 32) {
					const date = new Date(timeStr);
					if (!isNaN(date.getTime())) point.time = date;
				}
			}

			return [point];
		});

		return { name, points };
	});

	return { tracks };
}
