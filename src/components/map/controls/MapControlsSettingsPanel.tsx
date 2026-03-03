'use client';

import React, { type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { usePopoverFocusTrap } from '@/hooks';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Checkbox } from '@/components/ui/Checkbox';
import {
	IoMoonOutline,
	IoBatteryHalfOutline,
	IoHandLeftOutline,
	IoLayersOutline,
	IoSettingsOutline,
	IoHelpCircleOutline,
} from 'react-icons/io5';
import { CONTROL_BTN_BASE, CONTROL_BTN_ACTIVE, CONTROL_BTN_INACTIVE } from './map-controls-constants';
import { cn } from '@/lib/utils';

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
					className="z-controls-popover absolute top-1/2 right-[calc(100%+0.5rem)] flex w-52 -translate-y-1/2 flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-md dark:border-gray-600 dark:bg-gray-800"
					ref={popoverRef}
					role="dialog"
				>
					<h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">{preferencesTitle}</h3>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={darkMode} onCheckedChange={(checked) => setDarkMode(checked)} />
						<IoMoonOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-400" />
						<span className="text-sm text-gray-700 dark:text-gray-200">{darkModeLabel}</span>
					</label>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={batterySaverMode} onCheckedChange={(checked) => setBatterySaverMode(checked)} />
						<IoBatteryHalfOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-400" />
						<span className="text-sm text-gray-700 dark:text-gray-200">{batterySaverLabel}</span>
						<span className="inline-flex" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
							<SmartTooltip content={batterySaverTooltip} position="top">
								<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300" />
							</SmartTooltip>
						</span>
					</label>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={largeTouchTargets} onCheckedChange={(checked) => setLargeTouchTargets(checked)} />
						<IoHandLeftOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-400" />
						<span className="text-sm text-gray-700 dark:text-gray-200">{largeTouchTargetsLabel}</span>
					</label>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={showSections} onCheckedChange={(checked) => setShowSections(checked)} />
						<IoLayersOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-400" />
						<span className="text-sm text-gray-700 dark:text-gray-200">{t('showSections')}</span>
						<span className="inline-flex" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
							<SmartTooltip content={t('showSectionsTooltip')} position="top">
								<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300" />
							</SmartTooltip>
						</span>
					</label>
				</div>
			)}
			<SmartTooltip content={isExpanded ? tooltipHide : tooltipShow} position="left">
				<button
					aria-label={isExpanded ? tooltipHide : tooltipShow}
					className={cn(CONTROL_BTN_BASE, isExpanded ? CONTROL_BTN_ACTIVE : CONTROL_BTN_INACTIVE)}
					type="button"
					onClick={onToggle}
				>
					<IoSettingsOutline aria-hidden className="h-5 w-5" />
				</button>
			</SmartTooltip>
		</div>
	);
}
