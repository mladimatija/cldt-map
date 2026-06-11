/**
 * Pack weight and water carry math.
 *
 * Everything is stored canonically in metric (kg, liters, L/h); the unit
 * system only matters at the display/input boundary. Converting on render
 * instead of on switch means toggling metric/imperial back and forth can
 * never drift the stored value through cumulative rounding.
 *
 * The feature is "off" when packBaseWeightKg is null - every consumer
 * renders exactly as before in that case.
 */

import type { UnitSystem } from './types';

export const LB_PER_KG = 2.20462;
export const QT_PER_L = 1.05669;

/** Default drinking rate; 0.5-0.7 L/h is typical for summer karst hiking. */
export const DEFAULT_WATER_CONSUMPTION_LPH = 0.6;

/** Base weight (kg) below which the optional ETA penalty is zero. */
export const PACK_ETA_REFERENCE_KG = 8;

/** ETA penalty per kg of base weight above the reference: ~1% slower per kg.
 *  A deliberately conservative flat heuristic - published load/pace models
 *  depend on body weight, which the app does not ask for. */
export const PACK_ETA_PENALTY_PER_KG = 0.01;

/** Carry suggestions round up to this step so the number maps onto real
 *  bottles instead of suggesting 1.37 L. */
const CARRY_STEP_L = 0.5;

/** Carry chip turns amber at or above this volume. */
export const CARRY_WARN_L = 2;

// ── Unit boundary ────────────────────────────────────────────────────────

export function weightUnitLabel(units: UnitSystem): string {
	return units === 'imperial' ? 'lb' : 'kg';
}

export function volumeUnitLabel(units: UnitSystem): string {
	return units === 'imperial' ? 'qt' : 'L';
}

/** Canonical kg -> display number in the active unit system. */
export function kgToDisplay(kg: number, units: UnitSystem): number {
	return units === 'imperial' ? kg * LB_PER_KG : kg;
}

/** Display number in the active unit system -> canonical kg. */
export function displayToKg(value: number, units: UnitSystem): number {
	return units === 'imperial' ? value / LB_PER_KG : value;
}

/** Canonical L/h -> display number (qt/h when imperial). */
export function lphToDisplay(lph: number, units: UnitSystem): number {
	return units === 'imperial' ? lph * QT_PER_L : lph;
}

/** Display consumption number -> canonical L/h. */
export function displayToLph(value: number, units: UnitSystem): number {
	return units === 'imperial' ? value / QT_PER_L : value;
}

/** "10.2 kg" / "22.5 lb"; one decimal, trailing zero trimmed. */
export function formatWeight(kg: number, units: UnitSystem): string {
	const v = kgToDisplay(kg, units);
	const rounded = Math.round(v * 10) / 10;
	return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} ${weightUnitLabel(units)}`;
}

/** "3.5 L" / "3.7 qt"; one decimal, trailing zero trimmed. */
export function formatVolume(liters: number, units: UnitSystem): string {
	const v = units === 'imperial' ? liters * QT_PER_L : liters;
	const rounded = Math.round(v * 10) / 10;
	return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} ${volumeUnitLabel(units)}`;
}

// ── Carry math ───────────────────────────────────────────────────────────

/** Liters to carry across a dry stretch: hours at the given pace times the
 *  consumption rate, rounded up to the next half liter. Returns 0 for
 *  degenerate input so callers can simply hide the chip. */
export function waterCarryLiters(dryKm: number, paceKmh: number, consumptionLph: number): number {
	if (!(dryKm > 0) || !(paceKmh > 0) || !(consumptionLph > 0)) return 0;
	const liters = (dryKm / paceKmh) * consumptionLph;
	return Math.ceil(liters / CARRY_STEP_L) * CARRY_STEP_L;
}

/** Total pack weight: base plus water at 1 kg/L. */
export function packTotalKg(baseKg: number, liters: number): number {
	return baseKg + liters;
}

// ── Optional ETA adjustment ──────────────────────────────────────────────

/** Multiplier (>= 1) applied to travel time when the user enabled the
 *  pack-weight ETA adjustment. Based on base weight only - water carried
 *  varies per stage and folding it in would make ETAs disagree between
 *  surfaces that know the stage and surfaces that do not. */
export function packEtaMultiplier(baseKg: number | null, enabled: boolean): number {
	if (!enabled || baseKg === null || !(baseKg > PACK_ETA_REFERENCE_KG)) return 1;
	return 1 + (baseKg - PACK_ETA_REFERENCE_KG) * PACK_ETA_PENALTY_PER_KG;
}

/** Effective pace after the optional pack penalty; identity when disabled. */
export function effectivePaceKmh(paceKmh: number, baseKg: number | null, enabled: boolean): number {
	return paceKmh / packEtaMultiplier(baseKg, enabled);
}
