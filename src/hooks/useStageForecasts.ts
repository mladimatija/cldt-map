'use client';

/**
 * Per-stage daily weather forecasts for the stage planner.
 *
 * When the plan carries a trip start date, stage N is walked on
 * startDate + N days; for every stage whose day falls inside the 16-day
 * Open-Meteo horizon this hook fetches the daily forecast at the stage's
 * midpoint coordinates (one batched request for all stages) and returns the
 * results aligned by stage index. Stages outside the horizon, plans without
 * a start date, and network failures all yield null entries.
 */
import { useEffect, useState } from 'react';
import type { StagePlan } from '@/lib/store/types';
import { findNearestPointIndex } from '@/lib/distance-utils';
import { dayOffsetForStage } from '@/lib/stage-rest-days';
import { FORECAST_HORIZON_DAYS, fetchStageForecasts, type DailyForecast } from '@/lib/weather';

interface TrailPointLite {
	lat: number;
	lng: number;
	distanceFromStart: number;
}

const EMPTY: (DailyForecast | null)[] = [];

/** yyyy-mm-dd in local time, offset by `plusDays`. */
function isoDayFromToday(plusDays: number): string {
	const d = new Date();
	d.setDate(d.getDate() + plusDays);
	return isoDay(d);
}

function isoDay(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function addDays(isoDate: string, days: number): string {
	const d = new Date(`${isoDate}T12:00:00`);
	d.setDate(d.getDate() + days);
	return isoDay(d);
}

export function useStageForecasts(
	stagePlan: StagePlan | null,
	enhancedTrailPoints: TrailPointLite[] | null,
): (DailyForecast | null)[] {
	// Keyed by plan so results for a superseded plan are never shown; the
	// "no forecast" cases are derived (returned as EMPTY) rather than set in
	// the effect, which keeps the effect subscription-only.
	const [result, setResult] = useState<{ key: string; forecasts: (DailyForecast | null)[] } | null>(null);

	const planKey = stagePlan
		? `${stagePlan.startDate ?? ''}|${stagePlan.stages.map((s) => `${s.startKm}-${s.endKm}`).join(',')}|${(stagePlan.restDays ?? []).join('-')}`
		: '';

	useEffect(() => {
		if (!stagePlan?.startDate || !enhancedTrailPoints?.length || stagePlan.stages.length === 0) {
			return;
		}

		const today = isoDayFromToday(0);
		const horizonEnd = isoDayFromToday(FORECAST_HORIZON_DAYS - 1);

		const slots: ({ lat: number; lng: number; date: string } | null)[] = stagePlan.stages.map(
			(stage: { startKm: number; endKm: number }, i: number) => {
				const date = addDays(stagePlan.startDate as string, dayOffsetForStage(i, stagePlan.restDays));
				// ISO yyyy-mm-dd compares correctly as a string.
				if (date < today || date > horizonEnd) return null;
				const midM = ((stage.startKm + stage.endKm) / 2) * 1000;
				const pt = enhancedTrailPoints[findNearestPointIndex(enhancedTrailPoints, midM)];
				if (!pt) return null;
				return { lat: pt.lat, lng: pt.lng, date };
			},
		);

		const requests = slots.filter((s): s is { lat: number; lng: number; date: string } => s !== null);
		if (requests.length === 0) return;

		const abort = new AbortController();
		void fetchStageForecasts(requests, abort.signal).then((results) => {
			if (abort.signal.aborted) return;
			let cursor = 0;
			setResult({
				key: planKey,
				forecasts: slots.map((slot) => (slot === null ? null : (results[cursor++] ?? null))),
			});
		});
		return () => abort.abort();
		// planKey covers startDate + stage boundaries; enhancedTrailPoints
		// identity changes on direction flip, which also re-anchors midpoints.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [planKey, enhancedTrailPoints]);

	return result?.key === planKey ? result.forecasts : EMPTY;
}
