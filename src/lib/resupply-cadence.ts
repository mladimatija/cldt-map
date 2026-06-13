/**
 * Food resupply cadence for multi-day stage plans.
 *
 * Mirrors the water dry-stretch pattern: find grocery towns along the trail,
 * measure gaps inside each stage and across the plan, and estimate walking
 * days until the next full resupply. Bakery-only towns count as partial
 * resupply (amber chip) but not as grocery gap breakpoints.
 */

import type { Poi } from './poi-types';
import { longestDryStretchKm } from './water-intelligence';

/** Default food consumption for pack-day estimates (kg/day). */
export const DEFAULT_FOOD_CONSUMPTION_KG_PER_DAY = 0.6;

export type StageResupplyStatus = 'yes' | 'partial' | 'no' | null;

export interface ResupplyTownPoint {
	id: string;
	trailKm: number;
	/** True when the town has bakery but no grocery. */
	partial: boolean;
}

export interface StageResupplyCadence {
	status: StageResupplyStatus;
	/** Longest stretch without grocery inside this stage (km). */
	foodGapKm: number;
	/** Consecutive stages without a full grocery resupply, including this one when not yes. */
	stagesSinceGrocery: number;
	/** Trail km since the last grocery town before this stage start; null when unknown. */
	kmSinceGrocery: number | null;
	nextGrocery: ResupplyTownPoint | null;
	/** Distance from this stage's end to the next grocery town (km). */
	kmToNextGrocery: number | null;
	stagesUntilNextGrocery: number | null;
	walkingDaysToNextGrocery: number | null;
}

export interface PlanResupplyCadence {
	maxFoodGapKm: number;
	maxStagesWithoutGrocery: number;
	/** First grocery town at or after the plan start. */
	firstGrocery: ResupplyTownPoint | null;
	kmToFirstGrocery: number | null;
	stages: StageResupplyCadence[];
}

export function poiHasGroceryResupply(poi: Poi): boolean {
	return (
		(poi.type === 'town' || poi.type === 'settlement') &&
		!!poi.resupply?.places.some((place) => place.kind === 'grocery')
	);
}

export function stageResupplyStatus(stageStart: number, stageEnd: number, towns: Poi[]): StageResupplyStatus {
	const lo = Math.min(stageStart, stageEnd);
	const hi = Math.max(stageStart, stageEnd);
	const inStage = towns.filter(
		(t) => (t.type === 'town' || t.type === 'settlement') && t.trailKm >= lo && t.trailKm <= hi && t.resupply,
	);
	if (inStage.length === 0) {
		const anyTownInStage = towns.some(
			(t) => (t.type === 'town' || t.type === 'settlement') && t.trailKm >= lo && t.trailKm <= hi,
		);
		return anyTownInStage ? 'no' : null;
	}
	if (inStage.some((t) => t.resupply!.places.some((place) => place.kind === 'grocery'))) return 'yes';
	if (inStage.some((t) => t.resupply!.places.some((place) => place.kind === 'bakery'))) return 'partial';
	return 'no';
}

/** Town/settlement resupply anchors from the full POI dataset (ignores layer visibility). */
export function collectResupplyTownPoints(pois: Poi[]): ResupplyTownPoint[] {
	const out: ResupplyTownPoint[] = [];
	for (const poi of pois) {
		if (poi.type !== 'town' && poi.type !== 'settlement') continue;
		if (!poi.resupply) continue;
		const hasGrocery = poi.resupply.places.some((place) => place.kind === 'grocery');
		const hasBakery = poi.resupply.places.some((place) => place.kind === 'bakery');
		if (hasGrocery) out.push({ id: poi.id, trailKm: poi.trailKm, partial: false });
		else if (hasBakery) out.push({ id: poi.id, trailKm: poi.trailKm, partial: true });
	}
	return out.sort((a, b) => a.trailKm - b.trailKm);
}

function groceryTrailKms(points: ResupplyTownPoint[]): number[] {
	return points.filter((p) => !p.partial).map((p) => p.trailKm);
}

function lastGroceryBefore(km: number, points: ResupplyTownPoint[]): ResupplyTownPoint | null {
	let last: ResupplyTownPoint | null = null;
	for (const p of points) {
		if (p.partial) continue;
		if (p.trailKm < km) last = p;
		else break;
	}
	return last;
}

function nextGroceryAfter(km: number, points: ResupplyTownPoint[]): ResupplyTownPoint | null {
	return points.find((p) => !p.partial && p.trailKm > km) ?? null;
}

function countStagesUntilGrocery(
	stages: { startKm: number; endKm: number }[],
	fromIndex: number,
	towns: Poi[],
): number | null {
	for (let j = fromIndex + 1; j < stages.length; j++) {
		const status = stageResupplyStatus(stages[j].startKm, stages[j].endKm, towns);
		if (status === 'yes') return j - fromIndex;
	}
	const afterEnd = stages[fromIndex]?.endKm ?? 0;
	const next = nextGroceryAfter(afterEnd, collectResupplyTownPoints(towns));
	if (next) return stages.length - fromIndex;
	return null;
}

/** Walking days from km at the given pace and hours per hiking day. */
export function walkingDaysFromKm(km: number, paceKmh: number, hoursPerDay: number): number | null {
	if (!(km > 0) || !(paceKmh > 0) || !(hoursPerDay > 0)) return null;
	const days = km / paceKmh / hoursPerDay;
	return Math.round(days * 10) / 10;
}

export function estimatedFoodDaysFromPack(consumableKg: number, kgPerDay: number): number | null {
	if (!(consumableKg > 0) || !(kgPerDay > 0)) return null;
	return Math.round((consumableKg / kgPerDay) * 10) / 10;
}

export function computePlanResupplyCadence(
	stages: { startKm: number; endKm: number }[],
	towns: Poi[],
	resupplyPoints: ResupplyTownPoint[],
	paceKmh: number,
	hoursPerDay: number,
): PlanResupplyCadence | null {
	if (stages.length === 0) return null;

	const groceryKms = groceryTrailKms(resupplyPoints);
	const planStart = Math.min(stages[0].startKm, stages[0].endKm);
	const planEnd = Math.max(stages[stages.length - 1].startKm, stages[stages.length - 1].endKm);

	const maxFoodGapKm =
		groceryKms.length > 0 ? longestDryStretchKm(planStart, planEnd, groceryKms) : Math.max(0, planEnd - planStart);

	const firstGrocery = resupplyPoints.find((p) => !p.partial && p.trailKm >= planStart) ?? null;
	const kmToFirstGrocery = firstGrocery ? Math.max(0, firstGrocery.trailKm - planStart) : null;

	let maxStagesWithoutGrocery = 0;
	let runWithout = 0;

	const stageCadences: StageResupplyCadence[] = stages.map((stage, i) => {
		const lo = Math.min(stage.startKm, stage.endKm);
		const hi = Math.max(stage.startKm, stage.endKm);
		const status = stageResupplyStatus(stage.startKm, stage.endKm, towns);
		const foodGapKm = groceryKms.length > 0 ? longestDryStretchKm(lo, hi, groceryKms) : hi - lo;

		if (status === 'yes') {
			runWithout = 0;
		} else if (status === 'no' || status === 'partial') {
			runWithout++;
			maxStagesWithoutGrocery = Math.max(maxStagesWithoutGrocery, runWithout);
		}

		let stagesSinceGrocery = 0;
		if (status !== 'yes') {
			for (let j = i; j >= 0; j--) {
				const prevStatus = stageResupplyStatus(stages[j].startKm, stages[j].endKm, towns);
				if (j < i) stagesSinceGrocery++;
				if (prevStatus === 'yes') break;
			}
		}

		const prevGrocery = lastGroceryBefore(lo, resupplyPoints);
		const kmSinceGrocery = prevGrocery ? lo - prevGrocery.trailKm : i === 0 ? null : lo - planStart;

		const nextGrocery = nextGroceryAfter(hi, resupplyPoints);
		const kmToNextGrocery = nextGrocery ? nextGrocery.trailKm - hi : null;
		const stagesUntilNextGrocery = status === 'yes' ? 0 : countStagesUntilGrocery(stages, i, towns);
		const walkingDaysToNextGrocery =
			kmToNextGrocery !== null ? walkingDaysFromKm(kmToNextGrocery, paceKmh, hoursPerDay) : null;

		return {
			status,
			foodGapKm,
			stagesSinceGrocery,
			kmSinceGrocery,
			nextGrocery,
			kmToNextGrocery,
			stagesUntilNextGrocery,
			walkingDaysToNextGrocery,
		};
	});

	return {
		maxFoodGapKm,
		maxStagesWithoutGrocery,
		firstGrocery,
		kmToFirstGrocery,
		stages: stageCadences,
	};
}
