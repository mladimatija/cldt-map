import type { EnhancedTrailPoint, StagePlan } from '@/lib/store/types';
import { computeEta, findNearestPointIndex, gradeSegmentSeconds } from '@/lib/distance-utils';

/** Sensible upper bound for a sustained walking day - long-distance hikers
 *  typically walk 8-10 hours; 10 leaves headroom while preventing the planner
 *  from emitting physically impossible stages (e.g. 100 km/day at 4 km/h). */
export const DEFAULT_MAX_HOURS_PER_DAY = 10;

/**
 * Minimum number of stages required to keep each day under the given hour cap
 * at the supplied pace, accounting for grade adjustment when enabled.
 * Returns 1 when the trail fits entirely within a single day.
 */
export function computeMinStagesForCap(
	elevationPoints: { elevation: number; distanceFromStart: number }[],
	startKm: number,
	endKm: number,
	paceKmh: number,
	gradeAdjusted: boolean,
	maxHoursPerDay: number,
): number {
	if (maxHoursPerDay <= 0 || paceKmh <= 0 || startKm >= endKm) return 1;
	const startM = startKm * 1000;
	const endM = endKm * 1000;
	const startIdx = findNearestPointIndex(elevationPoints, startM);
	const endIdx = findNearestPointIndex(elevationPoints, endM);
	if (startIdx >= endIdx) return 1;
	const speedMps = (paceKmh * 1000) / 3600;
	let totalSec = 0;
	for (let i = startIdx; i < endIdx; i++) {
		const distSeg = elevationPoints[i + 1].distanceFromStart - elevationPoints[i].distanceFromStart;
		if (distSeg <= 0) continue;
		const dz = elevationPoints[i + 1].elevation - elevationPoints[i].elevation;
		totalSec += gradeAdjusted ? gradeSegmentSeconds(distSeg, dz, speedMps) : distSeg / speedMps;
	}
	const capSec = maxHoursPerDay * 3600;
	return Math.max(1, Math.ceil(totalSec / capSec));
}

export function splitByDistance(startKm: number, endKm: number, stageKm: number): StagePlan {
	if (stageKm <= 0 || startKm >= endKm)
		return { startKm, endKm, stages: [{ startKm, endKm }], balanceMode: 'distance' };
	const rangeKm = endKm - startKm;
	const stageCount = Math.ceil(rangeKm / stageKm);
	const stages: { startKm: number; endKm: number }[] = [];
	for (let i = 0; i < stageCount; i++) {
		const sKm = startKm + i * stageKm;
		const eKm = i === stageCount - 1 ? endKm : sKm + stageKm;
		stages.push({ startKm: sKm, endKm: eKm });
	}
	return { startKm, endKm, stages, balanceMode: 'distance' };
}

export function splitByEta(
	elevationPoints: { elevation: number; distanceFromStart: number }[],
	startKm: number,
	endKm: number,
	paceKmh: number,
	gradeAdjusted: boolean,
	stageCount: number,
): StagePlan {
	if (stageCount < 1 || startKm >= endKm || paceKmh <= 0)
		return { startKm, endKm, stages: [{ startKm, endKm }], balanceMode: 'eta' };

	const startM = startKm * 1000;
	const endM = endKm * 1000;
	const speedMps = (paceKmh * 1000) / 3600;
	const startIdx = findNearestPointIndex(elevationPoints, startM);
	const endIdx = findNearestPointIndex(elevationPoints, endM);

	if (startIdx >= endIdx) return { startKm, endKm, stages: [{ startKm, endKm }], balanceMode: 'eta' };

	const len = endIdx - startIdx + 1;
	const cumulSec = new Float64Array(len);
	for (let k = 1; k < len; k++) {
		const i = startIdx + k - 1;
		const j = startIdx + k;
		const distSeg = elevationPoints[j].distanceFromStart - elevationPoints[i].distanceFromStart;
		if (distSeg <= 0) {
			cumulSec[k] = cumulSec[k - 1];
			continue;
		}
		const dz = elevationPoints[j].elevation - elevationPoints[i].elevation;
		const sec = gradeAdjusted ? gradeSegmentSeconds(distSeg, dz, speedMps) : distSeg / speedMps;
		cumulSec[k] = cumulSec[k - 1] + sec;
	}

	const totalSec = cumulSec[len - 1];
	const targetSecPerStage = totalSec / stageCount;
	const stages: { startKm: number; endKm: number }[] = [];
	let prevBoundaryM = startM;

	for (let s = 1; s < stageCount; s++) {
		const targetSec = targetSecPerStage * s;
		let lo = 0;
		let hi = len - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (cumulSec[mid] < targetSec) lo = mid + 1;
			else hi = mid;
		}
		let boundaryM: number;
		if (lo === 0) {
			boundaryM = elevationPoints[startIdx].distanceFromStart;
		} else {
			const prevSec = cumulSec[lo - 1];
			const thisSec = cumulSec[lo];
			const fraction = thisSec > prevSec ? (targetSec - prevSec) / (thisSec - prevSec) : 0;
			const pA = elevationPoints[startIdx + lo - 1];
			const pB = elevationPoints[startIdx + lo];
			boundaryM = pA.distanceFromStart + (pB.distanceFromStart - pA.distanceFromStart) * fraction;
		}
		stages.push({ startKm: prevBoundaryM / 1000, endKm: boundaryM / 1000 });
		prevBoundaryM = boundaryM;
	}
	stages.push({ startKm: prevBoundaryM / 1000, endKm });
	return { startKm, endKm, stages, balanceMode: 'eta' };
}

export interface StageStats {
	distanceM: number;
	gainM: number;
	lossM: number;
	etaSec: number;
}

export function computeStageStats(
	stage: { startKm: number; endKm: number },
	enhancedPoints: EnhancedTrailPoint[],
	elevationPoints: { elevation: number; distanceFromStart: number }[],
	paceKmh: number,
	gradeAdjusted: boolean,
): StageStats {
	const startM = stage.startKm * 1000;
	const endM = stage.endKm * 1000;
	const distanceM = endM - startM;
	const enhancedStartIdx = findNearestPointIndex(enhancedPoints, startM);
	const enhancedEndIdx = findNearestPointIndex(enhancedPoints, endM);
	const startPoint = enhancedPoints[enhancedStartIdx];
	const endPoint = enhancedPoints[enhancedEndIdx];
	const gainM = endPoint.elevationGainFromStart - startPoint.elevationGainFromStart;
	const lossM = endPoint.elevationLossFromStart - startPoint.elevationLossFromStart;
	const elevStartIdx = findNearestPointIndex(elevationPoints, startM);
	const etaSec = computeEta(distanceM, paceKmh, {
		elevationPoints,
		fromIndex: elevStartIdx,
		gradeAdjusted,
	});
	return { distanceM, gainM, lossM, etaSec };
}
