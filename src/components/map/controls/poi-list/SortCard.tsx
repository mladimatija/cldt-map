'use client';

import React from 'react';
import { AHEAD_HORIZON_OPTIONS, formatAheadHorizon } from '@/lib/poi-ahead-corridor';
import { type SortMode } from '@/hooks';
import { cn } from '@/lib/cn';
import { Checkbox } from '@/components/ui/Checkbox';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { MapControlSingleSelect } from '../MapControlSelect';
import type { PoiListData } from './usePoiListData';

/** Sort order, the ahead horizon and the 50 km grouping. */
export function SortCard({ data }: { data: PoiListData }): React.ReactElement {
	const {
		aheadHorizonKm,
		aheadSummary,
		distancePrecision,
		groupByDecade,
		groupByDecadeLabel,
		hasTrailAnchor,
		poiListSortOpen,
		rows,
		selectedSortOption,
		setAheadHorizonKm,
		setGroupByDecade,
		setPoiListSortOpen,
		setSort,
		sort,
		sortOptions,
		t,
		units,
	} = data;

	return (
		<MapControlSectionCard
			collapsible
			open={poiListSortOpen}
			title={t('sections.sort')}
			onOpenChange={setPoiListSortOpen}
		>
			<div className="flex items-center gap-2">
				<div className="flex-1">
					<MapControlSingleSelect<{ value: SortMode; label: string }>
						aria-label={t('sortLabel')}
						options={sortOptions}
						placeholder={t('sortLabel')}
						value={selectedSortOption}
						onChange={(val) => {
							if (val) setSort(val.value);
						}}
					/>
				</div>
			</div>
			{sort === 'ahead' && (
				<div className="flex flex-wrap items-center gap-1">
					<span className="text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
						{t('aheadHorizonLabel')}
					</span>
					{AHEAD_HORIZON_OPTIONS.map((km) => (
						<button
							className={cn(
								'focus-visible:ring-cldt-green min-h-[28px] rounded-full border px-2 py-0.5 text-[0.625rem] font-medium tabular-nums focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
								aheadHorizonKm === km
									? 'border-cldt-blue bg-cldt-blue text-[var(--marker-on-color)]'
									: 'hover:border-cldt-blue border-gray-300 text-gray-600 dark:border-[var(--border-color)] dark:text-[var(--text-secondary)]',
							)}
							key={km}
							type="button"
							onClick={() => setAheadHorizonKm(km)}
						>
							{formatAheadHorizon(km, units, distancePrecision)}
						</button>
					))}
				</div>
			)}

			{sort === 'ahead' && !hasTrailAnchor ? (
				<p className="text-xs text-amber-700 italic dark:text-amber-300">{t('aheadNeedsAnchor')}</p>
			) : aheadSummary ? (
				<p className="text-xs text-gray-500 italic dark:text-[var(--text-secondary)]">{aheadSummary}</p>
			) : (
				<p className="text-xs text-gray-500 italic dark:text-[var(--text-secondary)]">
					{t('listCount', { count: rows.length })}
				</p>
			)}

			<label
				className={cn(
					'flex items-center gap-2 text-[0.625rem] tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]',
					sort !== 'trail' && 'opacity-40',
				)}
				title={groupByDecadeLabel}
			>
				<Checkbox checked={groupByDecade} disabled={sort !== 'trail'} onCheckedChange={setGroupByDecade} />
				<span>{groupByDecadeLabel}</span>
			</label>
		</MapControlSectionCard>
	);
}
