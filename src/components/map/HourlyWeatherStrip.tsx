'use client';

import React from 'react';
import type { HourlyStripData } from '@/lib/weather';

function precipBarColor(precipPct: number): string {
	if (precipPct < 30) return 'bg-[var(--cldt-blue)]';
	if (precipPct <= 70) return 'bg-amber-500';
	return 'bg-[var(--cldt-red)]';
}

interface HourlyWeatherStripProps {
	data: HourlyStripData;
	ariaLabel?: string;
}

export function HourlyWeatherStrip({ data, ariaLabel }: HourlyWeatherStripProps): React.ReactElement {
	const { columns, bestWindowHint } = data;

	return (
		<div aria-label={ariaLabel} className="overflow-hidden text-xs" role="group">
			<div
				className="gap-px"
				style={{
					display: 'grid',
					gridTemplateColumns: `repeat(${columns.length}, 1fr)`,
				}}
			>
				{columns.map((col) => (
					<div className="flex flex-col items-center" key={col.hourLabel}>
						<span className="sr-only">{col.precipSrText}</span>
						<span className="text-xs leading-tight">{col.hourLabel}</span>
						<div className="relative mt-0.5 h-7 w-full" title={col.precipSrText}>
							<div
								aria-hidden="true"
								className={`absolute right-0.5 bottom-0 left-0.5 ${precipBarColor(col.precipPct)}`}
								style={{ height: `${Math.max(col.precipPct, 2)}%` }}
							/>
						</div>
						<span className="mt-0.5 text-xs leading-tight">{col.temperature}</span>
					</div>
				))}
			</div>
			{bestWindowHint && <div className="mt-1 text-center text-xs font-medium">{bestWindowHint}</div>}
		</div>
	);
}
