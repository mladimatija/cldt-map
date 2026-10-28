'use client';

import React from 'react';
import { Button, buttonVariants } from '@/components/ui/Button';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { cn } from '@/lib/cn';
import { MAP_CONTROL_INPUT } from '../map-controls-constants';
import type { StagePlannerData } from './useStagePlannerData';

/** Itinerary for a trusted contact, with an alert buffer, copy, share and text. */
export function SafetyContactCard({ data }: { data: StagePlannerData }): React.ReactElement | null {
	const {
		canShareSafety,
		handleCopySafetyContact,
		handleShareSafetyContact,
		safetyBuffer,
		safetyContactBody,
		safetyContactPlan,
		safetyCopied,
		safetySmsHref,
		setSafetyBuffer,
		t,
	} = data;

	if (!safetyContactPlan) return null;
	return (
		<MapControlSectionCard title={t('safetyContact.heading')}>
			<p className="m-0 text-xs text-gray-600 dark:text-[var(--text-secondary)]">{t('safetyContact.intro')}</p>
			<div className="flex flex-col gap-0.5">
				<label className="text-xs text-gray-600 dark:text-[var(--text-secondary)]" htmlFor="safety-buffer-days">
					{t('safetyContact.bufferLabel')}
				</label>
				<input
					className={cn(MAP_CONTROL_INPUT, 'w-20 text-right tabular-nums')}
					id="safety-buffer-days"
					max={30}
					min={0}
					step={1}
					type="number"
					value={safetyBuffer}
					onChange={(e) => {
						const v = Number(e.target.value);
						if (Number.isFinite(v) && v >= 0) setSafetyBuffer(Math.min(30, Math.round(v)));
					}}
				/>
			</div>
			<p className="m-0 max-h-32 overflow-y-auto rounded bg-gray-50 p-2 text-xs whitespace-pre-wrap text-gray-600 dark:bg-[var(--bg-secondary)] dark:text-[var(--text-primary)]">
				{safetyContactBody}
			</p>
			<div className="flex flex-wrap gap-2">
				<Button
					className={cn(safetyCopied && 'text-cldt-green')}
					size="sm"
					variant="mapControlOutlineSecondary"
					onClick={handleCopySafetyContact}
				>
					{t('safetyContact.copy')}
				</Button>
				{canShareSafety ? (
					<Button size="sm" variant="mapControlOutlineSecondary" onClick={handleShareSafetyContact}>
						{t('safetyContact.share')}
					</Button>
				) : null}
				{safetySmsHref ? (
					<a className={cn(buttonVariants({ variant: 'mapControlOutlineSecondary', size: 'sm' }))} href={safetySmsHref}>
						{t('safetyContact.text')}
					</a>
				) : null}
			</div>
		</MapControlSectionCard>
	);
}
