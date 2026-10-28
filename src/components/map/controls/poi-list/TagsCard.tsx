'use client';

import React from 'react';
import { cn } from '@/lib/cn';
import { MAP_CONTROL_INLINE_LINK } from '../map-controls-constants';
import { MapControlSectionCard } from '../MapControlSectionCard';
import type { PoiListData } from './usePoiListData';

/** Tag filters, shown when the dataset carries tags. */
export function TagsCard({ data }: { data: PoiListData }): React.ReactElement | null {
	const { allTags, clearPoiTags, enabledPoiTags, poiListTagsOpen, setPoiListTagsOpen, t, togglePoiTag } = data;

	if (allTags.length === 0) return null;
	return (
		<MapControlSectionCard
			collapsible
			open={poiListTagsOpen}
			title={t('sections.tags')}
			onOpenChange={setPoiListTagsOpen}
		>
			<div className="flex flex-col gap-1">
				<div className="flex items-center justify-between text-[0.625rem] tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
					<span>{t('tagFilterHeading')}</span>
					{enabledPoiTags.size > 0 && (
						<button className={MAP_CONTROL_INLINE_LINK} type="button" onClick={clearPoiTags}>
							{t('tagFilterClear')}
						</button>
					)}
				</div>
				<div className="flex flex-wrap gap-1">
					{allTags.map((tag) => {
						const active = enabledPoiTags.has(tag);
						return (
							<button
								aria-pressed={active}
								className={cn(
									'focus-visible:ring-cldt-green inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border px-1.5 text-[0.625rem] transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
									active
										? 'border-cldt-blue bg-cldt-blue text-[var(--marker-on-color)]'
										: 'hover:border-cldt-blue border-gray-300 text-gray-600 dark:border-[var(--border-color)] dark:text-[var(--text-secondary)]',
								)}
								key={tag}
								type="button"
								onClick={() => togglePoiTag(tag)}
							>
								{tag}
							</button>
						);
					})}
				</div>
			</div>
		</MapControlSectionCard>
	);
}
