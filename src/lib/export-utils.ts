import { BaseMapProvider } from '@/lib/services/base-map-provider';

/** Providers whose tile servers don't send Access-Control-Allow-Origin; PNG canvas export will taint. */
const CORS_BLOCKED_PROVIDERS: string[] = [BaseMapProvider.SATELLITE, BaseMapProvider.CROATIA_TOPO];

/** Returns true if PNG export should be disabled for the given base map provider. */
export function isPngExportDisabled(provider: string): boolean {
	return CORS_BLOCKED_PROVIDERS.includes(provider);
}

/**
 * Returns the reason why PNG export is disabled for the provider,
 * or an empty string if export is allowed.
 */
export function getExportDisabledReason(provider: string): string {
	if (isPngExportDisabled(provider)) {
		return 'PNG export is unavailable for this map style due to tile server CORS restrictions.';
	}
	return '';
}

interface RulerRange {
	distanceFromStartA: number;
	distanceFromStartB: number;
}

interface PointWithDistance {
	lat: number;
	lng: number;
	distanceFromStart: number;
}

interface MinimalMap {
	fitBounds: (bounds: [[number, number], [number, number]], options?: object) => void;
}

/**
 * Fits the map view to the bounds of the ruler segment.
 * No-op when rulerRange is null or points are empty.
 */
export function fitMapToRulerBounds(
	map: MinimalMap,
	rulerRange: RulerRange | null,
	enhancedPoints: PointWithDistance[],
	options?: Record<string, unknown>,
): void {
	if (!rulerRange || enhancedPoints.length === 0) {
		return;
	}

	const { distanceFromStartA, distanceFromStartB } = rulerRange;
	const min = Math.min(distanceFromStartA, distanceFromStartB);
	const max = Math.max(distanceFromStartA, distanceFromStartB);

	const segmentPoints = enhancedPoints.filter((p) => p.distanceFromStart >= min && p.distanceFromStart <= max);

	if (segmentPoints.length === 0) {
		return;
	}

	let minLat = Infinity,
		maxLat = -Infinity,
		minLng = Infinity,
		maxLng = -Infinity;
	for (const p of segmentPoints) {
		if (p.lat < minLat) minLat = p.lat;
		if (p.lat > maxLat) maxLat = p.lat;
		if (p.lng < minLng) minLng = p.lng;
		if (p.lng > maxLng) maxLng = p.lng;
	}

	map.fitBounds(
		[
			[minLat, minLng],
			[maxLat, maxLng],
		],
		{ padding: [40, 40], ...options },
	);
}
