'use client';

import React, { type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { usePopoverFocusTrap } from '@/hooks';
import { IoColorPaletteOutline } from 'react-icons/io5';
import { MAP_CONTROL_POPOVER } from './map-controls-constants';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

interface ColorSettings {
	brightness: number;
	contrast: number;
	saturation: number;
}

interface SliderRowProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
}

function SliderRow({ label, value, min, max, step, onChange }: SliderRowProps): React.ReactElement {
	return (
		<div>
			<div className="mb-0.5 flex justify-between">
				<label className="text-xs text-gray-600 dark:text-[var(--text-secondary)]">{label}</label>
				<span className="text-cldt-blue dark:text-cldt-blue text-xs font-medium">{value}%</span>
			</div>
			<input
				className="precision-slider w-full min-w-0"
				max={max}
				min={min}
				step={step}
				type="range"
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
			/>
		</div>
	);
}

interface MapControlsColorAdjustProps {
	containerRef: RefObject<HTMLDivElement | null>;
	colorSettings: ColorSettings;
	setColorSettings: React.Dispatch<React.SetStateAction<ColorSettings>>;
	isEnabled: boolean;
	onToggle: () => void;
	tooltipShow: string;
	tooltipHide: string;
}

/** Color adjust popover: brightness, contrast, saturation sliders + reset. */
export function MapControlsColorAdjust({
	containerRef,
	colorSettings,
	setColorSettings,
	isEnabled,
	onToggle,
	tooltipShow,
	tooltipHide,
}: MapControlsColorAdjustProps): React.ReactElement {
	const t = useTranslations('mapControls');
	const popoverRef = usePopoverFocusTrap(isEnabled);

	return (
		<div className="relative inline-block w-10 shrink-0" ref={containerRef}>
			{isEnabled && (
				<div
					aria-label={t('colorMapAppearance')}
					aria-modal="true"
					className={cn(
						'absolute top-1/2 right-[calc(100%+0.5rem)] flex w-48 -translate-y-1/2 flex-col gap-3',
						MAP_CONTROL_POPOVER,
					)}
					ref={popoverRef}
					role="dialog"
				>
					<h3 className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]">
						{t('colorMapAppearance')}
					</h3>
					<div className="flex flex-col gap-2">
						<SliderRow
							label={t('colorBrightness')}
							max={150}
							min={50}
							step={5}
							value={colorSettings.brightness}
							onChange={(v) => setColorSettings((s) => ({ ...s, brightness: v }))}
						/>
						<SliderRow
							label={t('colorContrast')}
							max={150}
							min={50}
							step={5}
							value={colorSettings.contrast}
							onChange={(v) => setColorSettings((s) => ({ ...s, contrast: v }))}
						/>
						<SliderRow
							label={t('colorSaturation')}
							max={200}
							min={0}
							step={5}
							value={colorSettings.saturation}
							onChange={(v) => setColorSettings((s) => ({ ...s, saturation: v }))}
						/>
					</div>
					<Button
						className="w-full px-3 py-1.5 text-xs"
						variant="mapControlOutline"
						onClick={() => setColorSettings({ brightness: 100, contrast: 100, saturation: 100 })}
					>
						{t('colorReset')}
					</Button>
				</div>
			)}
			<SmartTooltip content={isEnabled ? tooltipHide : tooltipShow} position="left">
				<Button
					aria-label={isEnabled ? tooltipHide : tooltipShow}
					variant={isEnabled ? 'controlRoundActive' : 'controlRound'}
					onClick={onToggle}
				>
					<IoColorPaletteOutline aria-hidden className="h-5 w-5" />
				</Button>
			</SmartTooltip>
		</div>
	);
}
