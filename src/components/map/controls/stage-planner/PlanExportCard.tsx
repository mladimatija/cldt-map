'use client';

import React from 'react';
import {
	IoCalendarOutline,
	IoDocumentTextOutline,
	IoDownloadOutline,
	IoLocationOutline,
	IoMapOutline,
	IoTrailSignOutline,
	IoWatchOutline,
} from 'react-icons/io5';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Button } from '@/components/ui/Button';
import { MapControlIconButton } from '../MapControlIconButton';
import { MapControlSectionCard } from '../MapControlSectionCard';
import type { StagePlannerData } from './useStagePlannerData';

/** Stage and plan exports: GPX, FIT, POI waypoints, trip package, strip-map PDF, iCalendar, trip brief. */
export function PlanExportCard({ data }: { data: StagePlannerData }): React.ReactElement | null {
	const {
		activeStageIndex,
		allStagesWaypoints,
		handleAllStagesPoiExport,
		handleCancelPdfExport,
		handleFitExport,
		handleGpxExport,
		handleIcalExport,
		handleStripMapPdfExport,
		handleTripPackageExport,
		isPdfExporting,
		pdfProgress,
		setIsTripBriefOpen,
		setStagePlannerExportOpen,
		stagePlan,
		stagePlannerExportOpen,
		t,
	} = data;

	if (!stagePlan) return null;
	return (
		<MapControlSectionCard
			collapsible
			open={stagePlannerExportOpen}
			title={t('sections.export')}
			onOpenChange={setStagePlannerExportOpen}
		>
			<div className="flex flex-wrap gap-1.5">
				<SmartTooltip content={t('gpxExportTooltip')} position="top">
					<MapControlIconButton
						aria-label={t('gpxExport')}
						disabled={activeStageIndex === null}
						title={t('gpxExportTooltip')}
						variant="mapControlOutline"
						onClick={handleGpxExport}
					>
						<IoDownloadOutline aria-hidden className="h-3.5 w-3.5" />
					</MapControlIconButton>
				</SmartTooltip>
				<SmartTooltip content={t('fitExportTooltip')} position="top">
					<MapControlIconButton
						aria-label={t('fitExport')}
						disabled={activeStageIndex === null}
						title={t('fitExportTooltip')}
						variant="mapControlOutline"
						onClick={() => void handleFitExport()}
					>
						<IoWatchOutline aria-hidden className="h-3.5 w-3.5" />
					</MapControlIconButton>
				</SmartTooltip>
				<SmartTooltip content={t('gpxPoisExportTooltip')} position="top">
					<MapControlIconButton
						aria-label={t('gpxPoisExport')}
						disabled={allStagesWaypoints.length === 0}
						title={t('gpxPoisExportTooltip')}
						variant="mapControlOutline"
						onClick={handleAllStagesPoiExport}
					>
						<IoLocationOutline aria-hidden className="h-3.5 w-3.5" />
					</MapControlIconButton>
				</SmartTooltip>
				<SmartTooltip content={t('tripPackageExportTooltip')} position="top">
					<MapControlIconButton
						aria-label={t('tripPackageExport')}
						disabled={activeStageIndex === null}
						title={t('tripPackageExportTooltip')}
						variant="mapControlOutline"
						onClick={handleTripPackageExport}
					>
						<IoTrailSignOutline aria-hidden className="h-3.5 w-3.5" />
					</MapControlIconButton>
				</SmartTooltip>
				<SmartTooltip content={t('stripMapPdfTooltip')} position="top">
					<MapControlIconButton
						aria-label={t('stripMapPdf')}
						disabled={isPdfExporting}
						title={t('stripMapPdfTooltip')}
						variant="mapControlOutline"
						onClick={handleStripMapPdfExport}
					>
						<IoMapOutline aria-hidden className="h-3.5 w-3.5" />
					</MapControlIconButton>
				</SmartTooltip>
				<SmartTooltip content={stagePlan.startDate ? t('icalExportTooltip') : t('icalNeedsStartDate')} position="top">
					<MapControlIconButton
						aria-label={t('icalExport')}
						disabled={!stagePlan.startDate}
						title={stagePlan.startDate ? t('icalExportTooltip') : t('icalNeedsStartDate')}
						variant="mapControlOutline"
						onClick={handleIcalExport}
					>
						<IoCalendarOutline aria-hidden className="h-3.5 w-3.5" />
					</MapControlIconButton>
				</SmartTooltip>
				<SmartTooltip content={t('tripBriefOpenTooltip')} position="top">
					<MapControlIconButton
						aria-label={t('tripBriefOpen')}
						disabled={stagePlan.stages.length === 0}
						title={t('tripBriefOpenTooltip')}
						variant="mapControlOutline"
						onClick={() => setIsTripBriefOpen(true)}
					>
						<IoDocumentTextOutline aria-hidden className="h-3.5 w-3.5" />
					</MapControlIconButton>
				</SmartTooltip>
			</div>
			{isPdfExporting && (
				<div className="flex items-center gap-2 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
					<span className="flex-1 tabular-nums">
						{pdfProgress
							? t('stripMapPdfProgress', { current: pdfProgress.current, total: pdfProgress.total })
							: t('stripMapPdf')}
					</span>
					<Button
						size="sm"
						title={t('stripMapPdfCancelTooltip')}
						variant="mapControlOutlineSecondary"
						onClick={handleCancelPdfExport}
					>
						{t('stripMapPdfCancel')}
					</Button>
				</div>
			)}
		</MapControlSectionCard>
	);
}
