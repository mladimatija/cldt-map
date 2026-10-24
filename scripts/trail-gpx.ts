/**
 * Trail GPX loading shared by the data scripts: one fetch, the app's own
 * parser (parseTrackPoints, as used by the trail worker) and one
 * cumulative-distance pass with the app's haversine, so every script measures
 * trail km exactly like the app does.
 */
import { parseTrackPoints } from '../src/lib/gpx-parser';
import { haversineDistanceM } from '../src/lib/haversine';

export interface TrailGpxPoint {
	lat: number;
	lng: number;
	ele?: number;
	/** Metres from the first track point (GPX order, i.e. southbound). */
	cumM: number;
}

/** Fetches the trail GPX (default NEXT_PUBLIC_GPX_URL; http or https only). */
export async function fetchTrailGpx({
	url = process.env.NEXT_PUBLIC_GPX_URL,
	timeoutMs = 60_000,
}: { url?: string; timeoutMs?: number } = {}): Promise<string> {
	if (!url) {
		throw new Error('NEXT_PUBLIC_GPX_URL is not set (set it in .env.local or the environment).');
	}
	const parsed = new URL(url);
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		throw new Error(`NEXT_PUBLIC_GPX_URL must use http(s); got ${parsed.protocol}`);
	}
	const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
	if (!res.ok) {
		throw new Error(`Failed to fetch GPX: HTTP ${res.status} ${res.statusText}`);
	}
	return await res.text();
}

/** Track points of the GPX's first track, each with its distance from the start. */
export function loadTrailPoints(gpx: string): TrailGpxPoint[] {
	const raw = parseTrackPoints(gpx);
	const points: TrailGpxPoint[] = [];
	let cumM = 0;
	for (let i = 0; i < raw.length; i++) {
		if (i > 0) cumM += haversineDistanceM(raw[i - 1], raw[i]);
		points.push({ ...raw[i], cumM });
	}
	return points;
}
