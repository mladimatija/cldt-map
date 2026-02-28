'use client';

import React, { type RefObject } from 'react';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { IoOptionsOutline } from 'react-icons/io5';
import {
	DISTANCE_PRECISION_MIN,
	DISTANCE_PRECISION_MAX,
	CONTROL_BTN_BASE,
	CONTROL_BTN_INACTIVE,
} from './map-controls-constants';
import { cn } from '@/lib/utils';

interface MapControlsPrecisionSliderProps {
	containerRef: RefObject<HTMLDivElement | null>;
	isExpanded: boolean;
	onToggle: () => void;
	value: number;
	onChange: (value: number) => void;
	tooltipContent: string;
	tooltipExpanded: string;
}

/** Precision slider popover + button for distance decimal places. */
export function MapControlsPrecisionSlider({
	containerRef,
	isExpanded,
	onToggle,
	value,
	onChange,
	tooltipContent,
	tooltipExpanded,
}: MapControlsPrecisionSliderProps): React.ReactElement {
	return (
		<div className="relative inline-block w-10 shrink-0" ref={containerRef}>
			{isExpanded && (
				<div className="z-controls-popover absolute top-1/2 right-[calc(100%+0.5rem)] flex w-32 -translate-y-1/2 items-center gap-3 rounded-full border border-gray-200 bg-white px-3 py-2 shadow-md">
					<input
						className="precision-slider min-w-0 flex-1"
						max={DISTANCE_PRECISION_MAX}
						min={DISTANCE_PRECISION_MIN}
						step={1}
						type="range"
						value={value}
						onChange={(e) => onChange(Number(e.target.value))}
					/>
					<span className="text-cldt-blue shrink-0 text-sm font-semibold tabular-nums">{value}</span>
				</div>
			)}
			<SmartTooltip content={isExpanded ? tooltipExpanded : tooltipContent} offset={16} position="left">
				<button
					aria-label={isExpanded ? tooltipExpanded : tooltipContent}
					className={cn(CONTROL_BTN_BASE, CONTROL_BTN_INACTIVE)}
					title={`${value} decimal place${value !== 1 ? 's' : ''}`}
					type="button"
					onClick={onToggle}
				>
					<IoOptionsOutline aria-hidden className="h-5 w-5" />
				</button>
			</SmartTooltip>
		</div>
	);
}
