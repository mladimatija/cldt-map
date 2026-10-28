'use client';

import React from 'react';
import { formatDistance } from '@/lib/format';
import { totalTripDays } from '@/lib/stage-rest-days';
import type { StagePlannerData } from './useStagePlannerData';

/** Sticky trip summary above the cards: stage count, distance, rest days and food resupply. */
export function PlanSummaryCard({ data }: { data: StagePlannerData }): React.ReactElement | null {
	const {
		distancePrecision,
		planResupplyCadence,
		restDayCount,
		stagePlan,
		t,
		tripNextGroceryTown,
		tripTotalDistance,
		units,
	} = data;

	if (!stagePlan || !tripTotalDistance) return null;
	return (
		<div className="sticky top-0 z-[1] -mx-1 mb-1 border-b border-gray-200 bg-white px-1 pb-2 dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)]">
			<p className="m-0 text-sm font-semibold text-gray-900 dark:text-white">
				{t('tripSummaryLine', { count: stagePlan.stages.length, distance: tripTotalDistance })}
			</p>
			{restDayCount > 0 && (
				<p className="m-0 mt-0.5 text-[0.6875rem] text-gray-600 dark:text-[var(--text-secondary)]">
					<span aria-hidden>🛏️</span>{' '}
					{t('tripRestDays', {
						count: restDayCount,
						total: totalTripDays(stagePlan.stages.length, stagePlan.restDays),
					})}
				</p>
			)}
			{planResupplyCadence && (
				<p className="m-0 mt-0.5 text-[0.6875rem] text-gray-600 dark:text-[var(--text-secondary)]">
					<span aria-hidden>🛒</span>{' '}
					{t('tripFoodGap', {
						distance: formatDistance(planResupplyCadence.maxFoodGapKm, units, distancePrecision),
					})}
				</p>
			)}
			{tripNextGroceryTown &&
				planResupplyCadence?.kmToFirstGrocery !== null &&
				planResupplyCadence?.kmToFirstGrocery !== undefined && (
					<p className="m-0 text-[0.6875rem] text-gray-600 dark:text-[var(--text-secondary)]">
						{t('tripNextGrocery', {
							town: tripNextGroceryTown,
							distance: formatDistance(planResupplyCadence.kmToFirstGrocery, units, distancePrecision),
						})}
					</p>
				)}
		</div>
	);
}
