'use client';

import React from 'react';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { MAP_CONTROL_FOOTNOTE_LINK } from '../map-controls-constants';
import type { StagePlannerData } from './useStagePlannerData';
import { StageRow } from './StageRow';

// Shared fallbacks, so rows without POIs, selections or an open stage keep equal props.
const NO_POIS: StagePlannerData['stagePoisInTravelOrder'][number] = [];
const NO_SELECTED_POIS: ReadonlySet<string> = new Set();
const NO_STRETCHES: StagePlannerData['activeStageToughestStretches'] = [];

/** The generated stages, one expandable row each, with rest days between them. */
export function StagesCard({ data }: { data: StagePlannerData }): React.ReactElement | null {
	const {
		accommodationByStage,
		activeStageElevationThumb,
		activeStageIndex,
		activeStageToughestStretches,
		handleRegenerateForDirection,
		packScenariosByStage,
		planIsForOtherDirection,
		planResupplyCadence,
		selectedStagePoiIdsByStage,
		setStagePlannerStagesOpen,
		stageDateLabels,
		stageForecasts,
		stagePlan,
		stagePlannerStagesOpen,
		stagePoisInTravelOrder,
		stageRanges,
		stageRowShared,
		stageSacByStage,
		stageStats,
		t,
		waterGapByStage,
	} = data;

	if (!stagePlan) return null;
	return (
		<MapControlSectionCard
			collapsible
			open={stagePlannerStagesOpen}
			title={t('sections.stages')}
			onOpenChange={setStagePlannerStagesOpen}
		>
			{planIsForOtherDirection && (
				<p className="mt-0 mb-2 text-[0.6875rem] text-amber-700 dark:text-amber-400">
					{t('planOtherDirection')}{' '}
					<button className={MAP_CONTROL_FOOTNOTE_LINK} type="button" onClick={handleRegenerateForDirection}>
						{t('planRegenerate')}
					</button>
				</p>
			)}
			<div className="divide-y divide-gray-100 rounded border border-gray-100 dark:divide-[var(--border-color)] dark:border-[var(--border-color)]">
				{stagePlan.stages.map((stage, i) => {
					const isActive = i === activeStageIndex;
					return (
						<StageRow
							accommodation={accommodationByStage[i]}
							activeStageElevationThumb={isActive ? activeStageElevationThumb : null}
							activeStageToughestStretches={isActive ? activeStageToughestStretches : NO_STRETCHES}
							dateLabel={stageDateLabels[i]}
							forecast={stageForecasts[i]}
							i={i}
							isActive={isActive}
							key={`${stage.startKm}-${stage.endKm}`}
							packScenario={packScenariosByStage[i]}
							range={stageRanges[i]}
							restDays={stagePlan.restDays}
							shared={stageRowShared}
							stageCadence={planResupplyCadence?.stages[i]}
							stagePois={stagePoisInTravelOrder[i] ?? NO_POIS}
							stageSac={stageSacByStage[i]}
							stageSelectedPoiIds={selectedStagePoiIdsByStage.get(i) ?? NO_SELECTED_POIS}
							startDate={stagePlan.startDate}
							stats={stageStats[i]}
							waterGapKm={waterGapByStage[i]}
						/>
					);
				})}
			</div>
		</MapControlSectionCard>
	);
}
