import type { UnitSystem } from './types';

/** Unit conversion factors; the one place they are defined. */
export const KM_PER_MILE = 1.609344;
export const METRES_PER_MILE = 1609.344;
const FEET_PER_METRE = 3.28084;

export function kmToMiles(km: number): number {
	return km / KM_PER_MILE;
}

export function milesToKm(miles: number): number {
	return miles * KM_PER_MILE;
}

export function metresToFeet(metres: number): number {
	return metres * FEET_PER_METRE;
}

/** A distance in km in the unit system's own unit (km or miles). */
export function kmToUnit(km: number, units: UnitSystem): number {
	return units === 'imperial' ? kmToMiles(km) : km;
}

/** A distance given in km, in the unit system with a fixed number of decimals:
 *  "12.3 km" or "7.6 mi". Store-free, so documents and scripts can use it;
 *  formatDistance adds the user's precision on top. */
export function formatKm(km: number, units: UnitSystem, precision: number): string {
	return `${kmToUnit(km, units).toFixed(precision)} ${units === 'imperial' ? 'mi' : 'km'}`;
}
