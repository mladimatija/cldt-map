'use client';

import React, { useMemo } from 'react';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { formatDistance } from '@/lib/format';
import { junctionColor, junctionLabel, junctionRowKey } from '@/lib/trail-junctions';
import type { StagePlannerData } from './useStagePlannerData';

/** Marked trails that branch off the CLDT, listed per stage. */
export function JunctionsCard({ data }: { data: StagePlannerData }): React.ReactElement | null {
	const {
		distancePrecision,
		distanceUnitLabel,
		isNobo,
		junctionsByStage,
		junctionsSectionOpen,
		setJunctionsSectionOpen,
		stagePlan,
		tJunctions,
		toDisplay,
		totalStageJunctions,
		travelRange,
		units,
	} = data;

	// Kept across planner re-renders: it can run to hundreds of rows, and none of
	// its inputs change while the setup is edited or a stage is opened.
	const stageLists = useMemo(
		() =>
			stagePlan
				? junctionsByStage.map((list, i) => {
						if (list.length === 0) return null;
						const stage = stagePlan.stages[i];
						const range = travelRange(stage);
						const rows = isNobo ? [...list].reverse() : list;
						return (
							<div className="flex flex-col gap-0.5" key={`${stage.startKm}-${stage.endKm}`}>
								<p className="m-0 text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
									{i + 1}. {toDisplay(range.from).toFixed(0)}-{toDisplay(range.to).toFixed(0)} {distanceUnitLabel}
								</p>
								{rows.map((junction) => {
									const label = junctionLabel(junction, tJunctions('layerLabel'));
									return (
										<div className="flex items-center justify-between gap-2 px-0.5" key={junctionRowKey(junction)}>
											<span className="flex min-w-0 items-center gap-1.5">
												<span
													aria-hidden
													className="size-2 shrink-0 rounded-full"
													style={{ backgroundColor: junctionColor(junction) }}
												/>
												<span className="truncate text-xs text-gray-700 dark:text-[var(--text-primary)]" title={label}>
													{label}
												</span>
											</span>
											<span className="shrink-0 text-[0.625rem] text-gray-500 tabular-nums dark:text-[var(--text-secondary)]">
												{formatDistance(junction.trailKm, units, distancePrecision)}
											</span>
										</div>
									);
								})}
							</div>
						);
					})
				: null,
		[
			junctionsByStage,
			stagePlan,
			isNobo,
			travelRange,
			toDisplay,
			distanceUnitLabel,
			tJunctions,
			units,
			distancePrecision,
		],
	);

	if (!stagePlan || totalStageJunctions === 0) return null;
	return (
		<MapControlSectionCard
			collapsible
			open={junctionsSectionOpen}
			title={tJunctions('sectionTitle')}
			onOpenChange={setJunctionsSectionOpen}
		>
			<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{tJunctions('branchesOff')}</p>
			{stageLists}
			<p className="m-0 text-[0.625rem] text-gray-400 italic dark:text-[var(--text-secondary)]">
				{tJunctions('provenance')}
			</p>
		</MapControlSectionCard>
	);
}
