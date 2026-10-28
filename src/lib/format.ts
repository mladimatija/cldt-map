import { config } from '@/lib/config';
import { useMapStore } from '@/lib/store';
import type { UnitSystem } from '@/lib/types';
import { formatKm, metresToFeet } from '@/lib/units';

/**
 * Format distance with appropriate units
 *
 * @param distance Distance in kilometers (for metric) or meters (if needsConversion is true)
 * @param units Unit system to use (metric or imperial)
 * @param precision Number of decimal places; when undefined, uses store's distancePrecision (default 2)
 * @param needsConversion If true, treats the distance as meters and converts to km first
 * @returns Formatted distance string with units
 */
export function formatDistance(
	distance: number,
	units: UnitSystem,
	precision?: number,
	needsConversion: boolean = false,
): string {
	// Precision can come from store (user preference) or config default; avoid store access during SSR.
	if (precision === undefined) {
		precision = config.distancePrecision;
		if (typeof window !== 'undefined') {
			try {
				const mapState = useMapStore?.getState?.();
				if (typeof mapState?.distancePrecision === 'number') {
					precision = mapState.distancePrecision;
				}
			} catch {
				// Use config default when store not ready
			}
		}
	}

	return formatKm(needsConversion ? distance / 1000 : distance, units, precision);
}

/**
 * Format elevation with appropriate units
 *
 * @param elevation Elevation in meters
 * @param units Unit system to use (metric or imperial)
 * @param precision Number of decimal places for formatted output
 * @returns Formatted elevation string with units
 */
export function formatElevation(elevation: number, units: UnitSystem, precision: number = 0): string {
	return units === 'imperial'
		? `${metresToFeet(elevation).toFixed(precision)} ft`
		: `${elevation.toFixed(precision)} m`;
}
