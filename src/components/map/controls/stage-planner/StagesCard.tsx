'use client';

import React from 'react';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { MAP_CONTROL_FOOTNOTE_LINK } from '../map-controls-constants';
import type { StagePlannerData } from './useStagePlannerData';
import { StageRow } from './StageRow';

/** The generated stages, one expandable row each, with rest days between them. */
export function StagesCard({ data }: { data: StagePlannerData }): React.ReactElement | null {
	const {
		handleRegenerateForDirection,
		planIsForOtherDirection,
		setStagePlannerStagesOpen,
		stagePlan,
		stagePlannerStagesOpen,
		t,
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
				{stagePlan.stages.map((stage, i) => (
					<StageRow data={data} i={i} key={`${stage.startKm}-${stage.endKm}`} stage={stage} />
				))}
			</div>
		</MapControlSectionCard>
	);
}
