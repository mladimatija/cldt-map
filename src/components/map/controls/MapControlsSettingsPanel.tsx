'use client';

import React, { type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { usePopoverFocusTrap } from '@/hooks';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Checkbox } from '@/components/ui/Checkbox';
import { formatPace } from '@/lib/distance-utils';
import { useMapStore, type MapStoreState } from '@/lib/store';
import {
	IoMoonOutline,
	IoBatteryHalfOutline,
	IoHandLeftOutline,
	IoLayersOutline,
	IoSettingsOutline,
	IoHelpCircleOutline,
	IoWarningOutline,
} from 'react-icons/io5';
import { GRADE_BAND_ASCENT_COLORS } from '@/components/map/trail-route-constants';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { MAP_CONTROL_POPOVER } from './map-controls-constants';
import { MapControlsTileCachePanel } from './MapControlsTileCachePanel';
import { MapControlsImportsPanel } from './MapControlsImportsPanel';

interface MapControlsSettingsPanelProps {
	containerRef: RefObject<HTMLDivElement | null>;
	isExpanded: boolean;
	onToggle: () => void;
}

/** Settings popover: dark mode, battery saver, large touch targets, show sections. */
export function MapControlsSettingsPanel({
	containerRef,
	isExpanded,
	onToggle,
}: MapControlsSettingsPanelProps): React.ReactElement {
	const t = useTranslations('mapControls');
	const tWeather = useTranslations('severeWeather');
	const popoverRef = usePopoverFocusTrap(isExpanded);

	const darkMode = useMapStore((state: MapStoreState) => state.darkMode);
	const setDarkMode = useMapStore((state: MapStoreState) => state.setDarkMode);
	const batterySaverMode = useMapStore((state: MapStoreState) => state.batterySaverMode);
	const setBatterySaverMode = useMapStore((state: MapStoreState) => state.setBatterySaverMode);
	const largeTouchTargets = useMapStore((state: MapStoreState) => state.largeTouchTargets);
	const setLargeTouchTargets = useMapStore((state: MapStoreState) => state.setLargeTouchTargets);
	const showSections = useMapStore((state: MapStoreState) => state.showSections);
	const setShowSections = useMapStore((state: MapStoreState) => state.setShowSections);
	const gradeTintedTrail = useMapStore((state: MapStoreState) => state.gradeTintedTrail);
	const setGradeTintedTrail = useMapStore((state: MapStoreState) => state.setGradeTintedTrail);
	const walkingPaceKmh = useMapStore((state: MapStoreState) => state.walkingPaceKmh);
	const setWalkingPaceKmh = useMapStore((state: MapStoreState) => state.setWalkingPaceKmh);
	const gradeAdjustedEta = useMapStore((state: MapStoreState) => state.gradeAdjustedEta);
	const setGradeAdjustedEta = useMapStore((state: MapStoreState) => state.setGradeAdjustedEta);
	const sunsetProjection = useMapStore((state: MapStoreState) => state.sunsetProjection);
	const setSunsetProjection = useMapStore((state: MapStoreState) => state.setSunsetProjection);
	const severeWeatherLayer = useMapStore((state: MapStoreState) => state.severeWeatherLayer);
	const setSevereWeatherLayer = useMapStore((state: MapStoreState) => state.setSevereWeatherLayer);
	const units = useMapStore((state: MapStoreState) => state.units);

	const preferencesTitle = t('preferences');
	const tooltipShow = t('preferencesShow');
	const tooltipHide = t('preferencesHide');

	return (
		<div className="relative inline-block w-10 shrink-0" ref={containerRef}>
			{isExpanded && (
				<div
					aria-label={preferencesTitle}
					aria-modal="true"
					className={cn(
						MAP_CONTROL_POPOVER,
						'absolute top-1/2 right-[calc(100%+0.5rem)] flex max-h-[calc(100dvh-8rem)] w-80 -translate-y-1/2 flex-col gap-2 overflow-y-auto',
					)}
					ref={popoverRef}
					role="dialog"
				>
					<h3 className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]">{preferencesTitle}</h3>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={darkMode} onCheckedChange={(checked) => setDarkMode(checked)} />
						<IoMoonOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('darkMode')}</span>
					</label>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={batterySaverMode} onCheckedChange={(checked) => setBatterySaverMode(checked)} />
						<IoBatteryHalfOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('batterySaver')}</span>
						<span className="inline-flex" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
							<SmartTooltip content={t('batterySaverTooltip')} position="top">
								<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
							</SmartTooltip>
						</span>
					</label>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={largeTouchTargets} onCheckedChange={(checked) => setLargeTouchTargets(checked)} />
						<IoHandLeftOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('largeTouchTargets')}</span>
					</label>
					<p className="mt-1 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
						{t('layersSection')}
					</p>
					<fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
						<legend className="mb-1 flex items-center gap-2 p-0 text-sm text-gray-700 dark:text-[var(--text-primary)]">
							<IoLayersOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
							<span>{t('layers.trailStyle.legend')}</span>
							<span
								className="inline-flex"
								onClick={(e) => e.stopPropagation()}
								onMouseDown={(e) => e.stopPropagation()}
							>
								<SmartTooltip content={t('layers.trailStyle.tooltip')} position="top">
									<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
								</SmartTooltip>
							</span>
						</legend>
						{(() => {
							const selected = gradeTintedTrail ? 'grade' : showSections ? 'sections' : 'default';
							return (['default', 'sections', 'grade'] as const).map((option) => (
								<label className="flex cursor-pointer items-center gap-2 pl-6" key={option}>
									<input
										checked={selected === option}
										className="accent-cldt-blue focus-visible:ring-cldt-green h-4 w-4 cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
										name="trail-style"
										type="radio"
										value={option}
										onChange={() => {
											if (option === 'grade') {
												setGradeTintedTrail(true);
											} else if (option === 'sections') {
												setShowSections(true);
											} else {
												setShowSections(false);
												setGradeTintedTrail(false);
											}
										}}
									/>
									<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">
										{t(`layers.trailStyle.${option}`)}
									</span>
								</label>
							));
						})()}
					</fieldset>
					{gradeTintedTrail && (
						<div className="ml-6 flex flex-col gap-1 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
							<p className="font-semibold text-gray-700 dark:text-[var(--text-primary)]">
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
							<p className="mt-0.5 text-xs italic opacity-75">{t('layers.trailStyle.legendNote')}</p>
						</div>
					)}
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={severeWeatherLayer} onCheckedChange={(checked) => setSevereWeatherLayer(checked)} />
						<IoWarningOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{tWeather('layerLabel')}</span>
						<span className="inline-flex" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
							<SmartTooltip content={tWeather('layerTooltip')} position="top">
								<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
							</SmartTooltip>
						</span>
					</label>

					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2">
							<label className="text-sm text-gray-700 dark:text-[var(--text-primary)]" htmlFor="walking-pace-slider">
								{t('walkingPace')}
							</label>
							<span className="text-cldt-blue ml-auto shrink-0 text-sm font-semibold tabular-nums">
								{formatPace(walkingPaceKmh, units)}
							</span>
							{walkingPaceKmh !== 4 && (
								<button
									aria-label={t('walkingPaceReset')}
									className="text-cldt-blue min-h-[var(--min-touch-target)] min-w-[var(--min-touch-target)] cursor-pointer border-0 bg-transparent p-0 text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--cldt-green]"
									type="button"
									onClick={() => setWalkingPaceKmh(4)}
								>
									{t('walkingPaceReset')}
								</button>
							)}
						</div>
						<input
							className="precision-slider w-full min-w-0"
							id="walking-pace-slider"
							max={10}
							min={1}
							step={0.1}
							type="range"
							value={walkingPaceKmh}
							onChange={(e) => setWalkingPaceKmh(Number(e.target.value))}
						/>
						<p className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
							{t('walkingPaceHint', {
								min: formatPace(1, units),
								max: formatPace(10, units),
								default: formatPace(4, units),
							})}
						</p>
					</div>

					<label className="flex cursor-pointer items-start gap-2">
						<Checkbox checked={gradeAdjustedEta} onCheckedChange={(checked) => setGradeAdjustedEta(checked)} />
						<div className="flex flex-col">
							<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">
								{t('gradeAdjustedEtaLabel')}
							</span>
							<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
								{t('gradeAdjustedEtaHint')}
							</span>
						</div>
					</label>

					<label className="flex cursor-pointer items-start gap-2">
						<Checkbox checked={sunsetProjection} onCheckedChange={(checked) => setSunsetProjection(checked)} />
						<div className="flex flex-col">
							<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">
								{t('sunsetProjectionLabel')}
							</span>
							<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
								{t('sunsetProjectionHint')}
							</span>
						</div>
					</label>

					<MapControlsTileCachePanel />

					<MapControlsImportsPanel />

					<div className="mt-1 border-t border-gray-200 pt-2 dark:border-[var(--border-color)]">
						<div className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-[var(--text-primary)]">
							<IoHelpCircleOutline
								aria-hidden
								className="h-4 w-4 shrink-0 text-gray-500 dark:text-[var(--text-primary)]"
							/>
							<span>{t('helpTitle')}</span>
						</div>
						<ul className="mt-1 space-y-1 text-xs leading-snug text-gray-600 dark:text-[var(--text-secondary)]">
							<li>{t('helpItems.trailClick')}</li>
							<li>{t('helpItems.chartHover')}</li>
							<li>{t('helpItems.chartClickPin')}</li>
							<li>{t('helpItems.chartDragRuler')}</li>
							<li>
								{t.rich('helpItems.escCancelRuler', {
									kbd: (chunks) => (
										<kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-[11px] text-gray-700 dark:border-[var(--border-color)] dark:bg-[var(--bg-primary)] dark:text-[var(--text-primary)]">
											{chunks}
										</kbd>
									),
								})}
							</li>
						</ul>
					</div>
				</div>
			)}
			<SmartTooltip content={isExpanded ? tooltipHide : tooltipShow} position="left">
				<Button
					aria-label={isExpanded ? tooltipHide : tooltipShow}
					variant={isExpanded ? 'controlRoundActive' : 'controlRound'}
					onClick={onToggle}
				>
					<IoSettingsOutline aria-hidden className="h-5 w-5" />
				</Button>
			</SmartTooltip>
		</div>
	);
}