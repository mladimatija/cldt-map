'use client';

import React, { type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { usePopoverFocusTrap } from '@/hooks';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Checkbox } from '@/components/ui/Checkbox';
import { formatPace } from '@/lib/distance-utils';
import type { UnitSystem } from '@/lib/store';
import {
	IoMoonOutline,
	IoBatteryHalfOutline,
	IoHandLeftOutline,
	IoLayersOutline,
	IoSettingsOutline,
	IoHelpCircleOutline,
} from 'react-icons/io5';
import { Button } from '@/components/ui/Button';
import { MapControlsTileCachePanel } from './MapControlsTileCachePanel';

interface MapControlsSettingsPanelProps {
	containerRef: RefObject<HTMLDivElement | null>;
	isExpanded: boolean;
	onToggle: () => void;
	preferencesTitle: string;
	darkMode: boolean;
	setDarkMode: (checked: boolean) => void;
	batterySaverMode: boolean;
	setBatterySaverMode: (checked: boolean) => void;
	batterySaverTooltip: string;
	largeTouchTargets: boolean;
	setLargeTouchTargets: (checked: boolean) => void;
	showSections: boolean;
	setShowSections: (checked: boolean) => void;
	walkingPaceKmh: number;
	setWalkingPaceKmh: (pace: number) => void;
	units: UnitSystem;
	darkModeLabel: string;
	batterySaverLabel: string;
	largeTouchTargetsLabel: string;
	tooltipShow: string;
	tooltipHide: string;
}

/** Settings popover: dark mode, battery saver, large touch targets, show sections. */
export function MapControlsSettingsPanel({
	containerRef,
	isExpanded,
	onToggle,
	preferencesTitle,
	darkMode,
	setDarkMode,
	batterySaverMode,
	setBatterySaverMode,
	batterySaverTooltip,
	largeTouchTargets,
	setLargeTouchTargets,
	showSections,
	setShowSections,
	walkingPaceKmh,
	setWalkingPaceKmh,
	units,
	darkModeLabel,
	batterySaverLabel,
	largeTouchTargetsLabel,
	tooltipShow,
	tooltipHide,
}: MapControlsSettingsPanelProps): React.ReactElement {
	const t = useTranslations('mapControls');
	const popoverRef = usePopoverFocusTrap(isExpanded);

	return (
		<div className="relative inline-block w-10 shrink-0" ref={containerRef}>
			{isExpanded && (
				<div
					aria-label={preferencesTitle}
					aria-modal="true"
					className="z-controls-popover absolute top-1/2 right-[calc(100%+0.5rem)] flex w-80 -translate-y-1/2 flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-md dark:border-gray-600 dark:bg-gray-800"
					ref={popoverRef}
					role="dialog"
				>
					<h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">{preferencesTitle}</h3>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={darkMode} onCheckedChange={(checked) => setDarkMode(checked)} />
						<IoMoonOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-gray-200">{darkModeLabel}</span>
					</label>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={batterySaverMode} onCheckedChange={(checked) => setBatterySaverMode(checked)} />
						<IoBatteryHalfOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-gray-200">{batterySaverLabel}</span>
						<span className="inline-flex" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
							<SmartTooltip content={batterySaverTooltip} position="top">
								<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
							</SmartTooltip>
						</span>
					</label>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={largeTouchTargets} onCheckedChange={(checked) => setLargeTouchTargets(checked)} />
						<IoHandLeftOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-gray-200">{largeTouchTargetsLabel}</span>
					</label>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={showSections} onCheckedChange={(checked) => setShowSections(checked)} />
						<IoLayersOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-gray-200">{t('showSections')}</span>
						<span className="inline-flex" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
							<SmartTooltip content={t('showSectionsTooltip')} position="top">
								<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
							</SmartTooltip>
						</span>
					</label>

					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2">
							<label className="text-sm text-gray-700 dark:text-gray-200" htmlFor="walking-pace-slider">
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
						<p className="text-xs text-gray-500 dark:text-gray-400">
							{t('walkingPaceHint', {
								min: formatPace(1, units),
								max: formatPace(10, units),
								default: formatPace(4, units),
							})}
						</p>
					</div>

					<MapControlsTileCachePanel />

					<div className="mt-1 border-t border-gray-200 pt-2 dark:border-gray-600">
						<div className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-200">
							<IoHelpCircleOutline aria-hidden className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-200" />
							<span>{t('helpTitle')}</span>
						</div>
						<ul className="mt-1 space-y-1 text-xs leading-snug text-gray-600 dark:text-gray-300">
							<li>{t('helpItems.trailClick')}</li>
							<li>{t('helpItems.chartHover')}</li>
							<li>{t('helpItems.chartClickPin')}</li>
							<li>{t('helpItems.chartDragRuler')}</li>
							<li>
								{t.rich('helpItems.escCancelRuler', {
									kbd: (chunks) => (
										<kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-[11px] text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200">
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
