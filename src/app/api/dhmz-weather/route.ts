/**
 * Server-side proxy for DHMZ (Croatian Met Service) current weather conditions.
 * Fetches hrvatska_n.xml, finds the nearest station by haversine distance,
 * and returns a WeatherData-compatible JSON response.
 */
import { NextRequest, NextResponse } from 'next/server';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371;
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLng = ((lng2 - lng1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Maps a DHMZ VrijemeZnak code (e.g. "1", "12", "5n") to a WMO-compatible
 * code range consumed by weatherCodeToKey() in weather.ts.
 */
function dhmzCodeToWmo(raw: string): number {
	const n = parseInt(raw.replace('n', ''), 10);
	if (n === 1) return 0; // clear
	if (n <= 4) return 2; // partly cloudy
	if (n <= 6) return 3; // overcast
	if ((n >= 7 && n <= 11) || (n >= 39 && n <= 42)) return 45; // fog
	if (n === 12 || n === 13 || n === 26 || n === 27) return 61; // light/moderate rain
	if (n === 14 || n === 28 || n === 32) return 65; // heavy rain
	if (n === 15 || n === 25 || n === 29) return 95; // thunderstorm
	if ((n >= 16 && n <= 18) || n === 30 || n === 31) return 96; // thunderstorm + rain
	if ((n >= 19 && n <= 21) || (n >= 33 && n <= 35)) return 67; // sleet
	if ((n >= 22 && n <= 24) || (n >= 36 && n <= 38)) return 73; // snow
	return 3;
}

/** NOAA wind chill apparent temperature. */
function apparentTemp(tempC: number, windKmh: number): number {
	if (windKmh >= 4.8 && tempC <= 10) {
		return 13.12 + 0.6215 * tempC - 11.37 * windKmh ** 0.16 + 0.3965 * tempC * windKmh ** 0.16;
	}
	return tempC;
}

/** Extract the text content of the first matching XML tag (no nesting assumed). */
function extractTag(xml: string, tag: string): string {
	const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`));
	return match?.[1]?.trim() ?? '';
}

interface Station {
	lat: number;
	lng: number;
	tempC: number;
	windMs: number;
	code: string;
}

/** Parse <Grad> blocks from the raw XML text without a DOM library. */
function parseStations(xml: string): Station[] {
	const stations: Station[] = [];
	const parts = xml.split('</Grad>');
	for (const part of parts) {
		const start = part.lastIndexOf('<Grad');
		if (start === -1) continue;
		const block = part.slice(start);
		const lat = parseFloat(extractTag(block, 'Lat'));
		const lng = parseFloat(extractTag(block, 'Lon'));
		if (isNaN(lat) || isNaN(lng)) continue;
		stations.push({
			lat,
			lng,
			tempC: parseFloat(extractTag(block, 'Temp')) || 0,
			windMs: parseFloat(extractTag(block, 'VjetarBrzina')) || 0,
			code: extractTag(block, 'VrijemeZnak'),
		});
	}
	return stations;
}

export async function GET(request: NextRequest): Promise<Response> {
	const { searchParams } = new URL(request.url);
	const lat = parseFloat(searchParams.get('lat') ?? '');
	const lng = parseFloat(searchParams.get('lng') ?? '');

	if (isNaN(lat) || isNaN(lng)) {
		return NextResponse.json({ error: 'Missing lat/lng' }, { status: 400 });
	}

	try {
		const res = await fetch('https://vrijeme.hr/hrvatska_n.xml', {
			next: { revalidate: 300 },
		});
		if (!res.ok) {
			return NextResponse.json({ error: `DHMZ returned ${res.status}` }, { status: 502 });
		}

		const xml = await res.text();
		const stations = parseStations(xml);

		let nearest: Station | null = null;
		let minDist = Infinity;
		for (const station of stations) {
			const dist = haversineKm(lat, lng, station.lat, station.lng);
			if (dist < minDist) {
				minDist = dist;
				nearest = station;
			}
		}

		if (!nearest) {
			return NextResponse.json({ error: 'No nearby station found' }, { status: 404 });
		}

		const windKmh = Math.round(nearest.windMs * 3.6);

		return NextResponse.json(
			{
				temperatureC: nearest.tempC,
				feelsLikeC: apparentTemp(nearest.tempC, windKmh),
				precipitationProbabilityPct: 0,
				windspeedKmh: windKmh,
				weatherCode: dhmzCodeToWmo(nearest.code),
				sunrise: '',
				sunset: '',
			},
			{ headers: { 'Cache-Control': 'public, max-age=300' } },
		);
	} catch (err) {
		console.error('[dhmz-weather]', err);
		return NextResponse.json({ error: 'Failed to fetch DHMZ data' }, { status: 500 });
	}
}
