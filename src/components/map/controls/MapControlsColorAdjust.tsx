'use client';

import React, { type RefObject } from 'react';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { IoColorPaletteOutline } from 'react-icons/io5';
import { CONTROL_BTN_BASE, CONTROL_BTN_ACTIVE, CONTROL_BTN_INACTIVE } from './map-controls-constants';
import { cn } from '@/lib/utils';

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
				<label className="text-xs text-gray-600">{label}</label>
				<span className="text-cldt-blue text-xs font-medium">{value}%</span>
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
	return (
		<div className="relative inline-block w-10 shrink-0" ref={containerRef}>
			{isEnabled && (
				<div className="z-controls-popover absolute top-1/2 right-[calc(100%+0.5rem)] flex w-48 -translate-y-1/2 flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-md">
					<h3 className="text-sm font-medium text-gray-700">Map Appearance</h3>
					<div className="flex flex-col gap-2">
						<SliderRow
							label="Brightness"
							max={150}
							min={50}
							step={5}
							value={colorSettings.brightness}
							onChange={(v) => setColorSettings((s) => ({ ...s, brightness: v }))}
						/>
						<SliderRow
							label="Contrast"
							max={150}
							min={50}
							step={5}
							value={colorSettings.contrast}
							onChange={(v) => setColorSettings((s) => ({ ...s, contrast: v }))}
						/>
						<SliderRow
							label="Saturation"
							max={200}
							min={0}
							step={5}
							value={colorSettings.saturation}
							onChange={(v) => setColorSettings((s) => ({ ...s, saturation: v }))}
						/>
					</div>
					<button
						className="hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green w-full cursor-pointer rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 transition-all outline-none"
						type="button"
						onClick={() => setColorSettings({ brightness: 100, contrast: 100, saturation: 100 })}
					>
						Reset
					</button>
				</div>
			)}
			<SmartTooltip content={isEnabled ? tooltipHide : tooltipShow} position="left">
				<button
					aria-label={isEnabled ? tooltipHide : tooltipShow}
					className={cn(
						CONTROL_BTN_BASE,
						isEnabled ? CONTROL_BTN_ACTIVE : CONTROL_BTN_INACTIVE,
						'focus-visible:border-cldt-green focus-visible:text-cldt-green',
					)}
					type="button"
					onClick={onToggle}
				>
					<IoColorPaletteOutline aria-hidden className="h-5 w-5" />
				</button>
			</SmartTooltip>
		</div>
	);
}
