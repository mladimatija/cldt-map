'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { IoLayersOutline, IoFlagOutline } from 'react-icons/io5';
import {
	GRADE_BAND_ASCENT_COLORS,
	SAC_BUCKET_SHORT_LABELS,
	SAC_COLORS,
	SURFACE_COLORS,
} from '@/components/map/trail-route-constants';
import { cn } from '@/lib/cn';
import { SAC_BUCKETS, SURFACE_BUCKETS } from '@/components/charts/elevation-chart-shared';
import { SacScaleExplainer } from '@/components/charts/SacScaleExplainer';
import { Radio } from '@/components/ui/Radio';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { SettingsToggleRow } from '../SettingsToggleRow';
import { useShallow } from 'zustand/react/shallow';
import { LEGEND_PANEL } from './settings-styles';

/** Trail style (sections, grade, surface, SAC) with its legend, and the distance markers. */
export function TrailAppearanceCard(): React.ReactElement {
	const t = useTranslations('mapControls');
	const {
		showSections,
		setShowSections,
		gradeTintedTrail,
		setGradeTintedTrail,
		surfaceColoured,
		setSurfaceColoured,
		sacColoured,
		setSacColoured,
		trailOsmTagsFile,
		showDistanceMarkers,
		setShowDistanceMarkers,
	} = useMapStore(
		useShallow((s: MapStoreState) => ({
			showSections: s.showSections,
			setShowSections: s.setShowSections,
			gradeTintedTrail: s.gradeTintedTrail,
			setGradeTintedTrail: s.setGradeTintedTrail,
			surfaceColoured: s.surfaceColoured,
			setSurfaceColoured: s.setSurfaceColoured,
			sacColoured: s.sacColoured,
			setSacColoured: s.setSacColoured,
			trailOsmTagsFile: s.trailOsmTagsFile,
			showDistanceMarkers: s.showDistanceMarkers,
			setShowDistanceMarkers: s.setShowDistanceMarkers,
		})),
	);
	const trailStyleSelected = sacColoured
		? 'sac'
		: surfaceColoured
			? 'surface'
			: gradeTintedTrail
				? 'grade'
				: showSections
					? 'sections'
					: 'default';
	const osmReady = Boolean(trailOsmTagsFile?.runs?.length);

	return (
		<MapControlSectionCard title={t('sections.trailAppearance')}>
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<IoLayersOutline aria-hidden className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
					<span className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]">
						{t('layers.trailStyle.legend')}
					</span>
				</div>
				<div className="grid grid-cols-2 gap-1.5">
					{(['default', 'sections', 'grade', 'surface', 'sac'] as const).map((option) => {
						const disabled = (option === 'surface' || option === 'sac') && !osmReady;
						return (
							<label
								className={cn(
									'flex items-center gap-2',
									disabled ? 'pointer-events-none cursor-not-allowed opacity-50' : 'cursor-pointer',
								)}
								key={option}
							>
								<Radio
									checked={trailStyleSelected === option}
									disabled={disabled}
									name="trail-style"
									value={option}
									onChange={() => {
										if (option === 'sac') {
											setSacColoured(true);
										} else if (option === 'surface') {
											setSurfaceColoured(true);
										} else if (option === 'grade') {
											setGradeTintedTrail(true);
										} else if (option === 'sections') {
											setShowSections(true);
										} else {
											setShowSections(false);
											setGradeTintedTrail(false);
											setSurfaceColoured(false);
											setSacColoured(false);
										}
									}}
								/>
								<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">
									{t(`layers.trailStyle.${option}`)}
									{disabled && (
										<span className="ml-1 text-xs italic opacity-75">({t('layers.trailStyle.dataUnavailable')})</span>
									)}
								</span>
							</label>
						);
					})}
				</div>
				<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('layers.trailStyle.tooltip')}</p>
			</div>

			{gradeTintedTrail && (
				<div className={LEGEND_PANEL}>
					<p className="m-0 mb-1 font-semibold text-gray-700 dark:text-[var(--text-primary)]">
						{t('layers.trailStyle.legendTitle')}
					</p>
					{(
						[
							{ band: 0, key: 'legendFlat', range: '0-3%' },
							{ band: 1, key: 'legendModerate', range: '3-6%' },
							{ band: 2, key: 'legendSteep', range: '6-10%' },
							{ band: 3, key: 'legendVerySteep', range: '10-15%' },
							{ band: 4, key: 'legendExtreme', range: '>15%' },
						] as const
					).map(({ band, key, range }) => (
						<div className="flex items-center gap-2" key={key}>
							<span
								aria-hidden="true"
								className="inline-block h-2 w-6 shrink-0 rounded-sm"
								style={{ backgroundColor: GRADE_BAND_ASCENT_COLORS[band] }}
							/>
							<span>
								{t(`layers.trailStyle.${key}`)} ({range})
							</span>
						</div>
					))}
					<p className="mt-1 mb-0 text-xs italic opacity-75">{t('layers.trailStyle.legendNote')}</p>
				</div>
			)}
			{surfaceColoured && (
				<div className={LEGEND_PANEL}>
					<p className="m-0 mb-1 font-semibold text-gray-700 dark:text-[var(--text-primary)]">
						{t('layers.trailStyle.surfaceLegendTitle')}
					</p>
					{SURFACE_BUCKETS.map((bucket) => (
						<div className="flex items-center gap-2" key={bucket}>
							<span
								aria-hidden="true"
								className="inline-block h-2 w-6 shrink-0 rounded-sm"
								style={{ backgroundColor: SURFACE_COLORS[bucket] }}
							/>
							<span>{t(`layers.trailStyle.surfaceBuckets.${bucket}`)}</span>
						</div>
					))}
				</div>
			)}
			{sacColoured && (
				<div className={LEGEND_PANEL}>
					<p className="m-0 mb-1 font-semibold text-gray-700 dark:text-[var(--text-primary)]">
						{t('layers.trailStyle.sacLegendTitle')}
					</p>
					{SAC_BUCKETS.map((key) => (
						<div className="flex items-center gap-2" key={key}>
							<span
								aria-hidden="true"
								className="inline-block h-2 w-6 shrink-0 rounded-sm"
								style={{ backgroundColor: SAC_COLORS[key] }}
							/>
							<span>
								<span className="font-mono">{SAC_BUCKET_SHORT_LABELS[key]}</span>{' '}
								{t(`layers.trailStyle.sacBuckets.${key}`)}
							</span>
						</div>
					))}
					<SacScaleExplainer />
				</div>
			)}

			<SettingsToggleRow
				checked={showDistanceMarkers}
				icon={<IoFlagOutline className="h-4 w-4" />}
				label={t('showDistanceMarkers')}
				tooltip={t('showDistanceMarkersTooltip')}
				onCheckedChange={(checked) => setShowDistanceMarkers(checked)}
			/>
		</MapControlSectionCard>
	);
}
