import { isMobile } from '@/lib/device';

/**
 * Build a navigation URL from the user's current location to a destination point.
 * On mobile: uses geo: URI to open the device's default maps app (whatever the user has installed).
 * On desktop: uses Google Maps in the browser.
 *
 * @param originLat User's current latitude
 * @param originLng User's current longitude
 * @param destLat Destination latitude
 * @param destLng Destination longitude
 * @returns URL to open for navigation
 */
export function getNavigateToPointUrl(originLat: number, originLng: number, destLat: number, destLng: number): string {
	// Defence-in-depth: clamp to finite numbers before interpolating into URIs.
	if (
		!Number.isFinite(originLat) ||
		!Number.isFinite(originLng) ||
		!Number.isFinite(destLat) ||
		!Number.isFinite(destLng)
	) {
		return '';
	}
	if (isMobile()) {
		return `geo:${destLat},${destLng}`;
	}
	return `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}`;
}

/** A link that shows the point in a maps app: the device's default one through
 *  a geo: URI on mobile, Google Maps in the browser elsewhere. */
export function coordinatesMapsUrl(lat: number, lng: number): string {
	const point = `${lat.toFixed(6)},${lng.toFixed(6)}`;
	return isMobile() ? `geo:${point}?q=${point}` : `https://www.google.com/maps?q=${point}`;
}

/**
 * Open a map app at the given coordinates (no directions, just the point).
 * On mobile: opens the device's default maps app via `geo:` URI (Apple Maps,
 *   Google Maps, OsmAnd, Organic Maps, whatever the user has set as default).
 * On desktop: opens Google Maps in a new tab.
 *
 * Shared between the trail click tooltip and the POI popup so both surfaces
 * use the same "view this point externally" affordance; the SOS panel links to
 * the same URL.
 *
 * @param lat Latitude
 * @param lng Longitude
 */
export function openCoordinatesInMaps(lat: number, lng: number): void {
	if (typeof window === 'undefined') return;
	// Defence-in-depth: clamp to finite numbers before interpolating into URIs.
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
	const url = coordinatesMapsUrl(lat, lng);
	if (isMobile()) {
		window.location.href = url;
	} else {
		window.open(url, '_blank', 'noopener,noreferrer');
	}
}
