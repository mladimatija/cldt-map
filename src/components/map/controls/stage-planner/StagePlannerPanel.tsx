'use client';

import React from 'react';
import { Polyline } from 'react-leaflet';
import { Button } from '@/components/ui/Button';
import { MapControlsTripBriefModal } from '../MapControlsTripBriefModal';
import { cn } from '@/lib/cn';
import { MAP_CONTROL_PANEL_WIDTH, MAP_CONTROL_POPOVER } from '../map-controls-constants';
import { useStagePlannerData } from './useStagePlannerData';
import { PlanSummaryCard } from './PlanSummaryCard';
import { PlanSetupCard } from './PlanSetupCard';
import { StagesCard } from './StagesCard';
import { JunctionsCard } from './JunctionsCard';
import { PlanExportCard } from './PlanExportCard';
import { SafetyContactCard } from './SafetyContactCard';

/** Stage planner popover: the stage highlight on the map, the cards, the reset footer and the trip brief. */
export function StagePlannerPanel(): React.ReactElement {
	const data = useStagePlannerData();
	const {
		confirmReset,
		handleConfirmReset,
		highlightPositions,
		isTripBriefOpen,
		popoverRef,
		setConfirmReset,
		setIsTripBriefOpen,
		stagePlan,
		t,
	} = data;

	return (
		<>
			{highlightPositions.length > 0 && (
				<Polyline pathOptions={{ color: 'var(--cldt-blue)', opacity: 0.9, weight: 6 }} positions={highlightPositions} />
			)}
			<div
				aria-labelledby="stage-planner-title"
				aria-modal="true"
				className={cn(
					'z-controls-popover fixed top-2 right-16 flex max-h-[calc(100dvh-4rem)] flex-col gap-2 overflow-hidden',
					MAP_CONTROL_PANEL_WIDTH,
					MAP_CONTROL_POPOVER,
				)}
				ref={popoverRef}
				role="dialog"
				onContextMenu={(e) => e.preventDefault()}
				onMouseDown={(e) => e.stopPropagation()}
				onTouchStart={(e) => e.stopPropagation()}
			>
				<h3
					className="shrink-0 text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]"
					id="stage-planner-title"
				>
					{t('title')}
				</h3>

				<div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
					<div className="flex flex-col gap-2">
						<PlanSummaryCard data={data} />

						<PlanSetupCard data={data} />

						{!stagePlan && (
							<p className="mb-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('noStages')}</p>
						)}

						<StagesCard data={data} />

						<JunctionsCard data={data} />

						<PlanExportCard data={data} />

						<SafetyContactCard data={data} />
					</div>
				</div>

				{stagePlan && (
					<div className="shrink-0 border-t border-gray-200 pt-2 dark:border-[var(--border-color)]">
						{confirmReset ? (
							<div className="flex items-center gap-2 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
								<span className="flex-1">{t('confirmReset')}</span>
								<Button size="sm" variant="mapControlOutlineSecondary" onClick={handleConfirmReset}>
									{t('confirmYes')}
								</Button>
								<Button size="sm" variant="mapControlOutline" onClick={() => setConfirmReset(false)}>
									{t('confirmNo')}
								</Button>
							</div>
						) : (
							<Button
								className="w-full"
								size="sm"
								title={t('resetTooltip')}
								variant="mapControlOutlineSecondary"
								onClick={() => setConfirmReset(true)}
							>
								{t('reset')}
							</Button>
						)}
					</div>
				)}
			</div>
			<MapControlsTripBriefModal open={isTripBriefOpen} onClose={() => setIsTripBriefOpen(false)} />
		</>
	);
}
