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

const MAX_GPX_BYTES = 10 * 1024 * 1024;

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
				const date = new Date(timeEl.textContent.trim());
				if (!isNaN(date.getTime())) point.time = date;
			}

			return [point];
		});

		return { name, points };
	});

	return { tracks };
}
