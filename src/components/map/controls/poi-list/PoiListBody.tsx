'use client';

import React from 'react';
import { defaultEnabledPoiTypes } from '@/lib/config';
import { Button } from '@/components/ui/Button';
import type { PoiListData } from './usePoiListData';

/** The rows, flat or grouped by 50 km, with the empty and loading states. */
export function PoiListBody({ data }: { data: PoiListData }): React.ReactElement {
	const { enabledPoiTypes, groupedItems, poisFile, poisLayerEnabled, renderRow, rows, setEnabledPoiTypes, t } = data;

	return (
		<div className="flex min-h-0 flex-col gap-0.5" role="listbox">
			{rows.length === 0 &&
				(poisFile?.pois?.length && poisLayerEnabled && enabledPoiTypes.size === 0 ? (
					<div className="flex flex-col gap-1.5 px-1 py-2">
						<p className="text-xs text-gray-500 italic dark:text-[var(--text-secondary)]">{t('noPoiTypesSelected')}</p>
						<Button
							className="self-start"
							size="sm"
							variant="mapControlOutline"
							onClick={() => setEnabledPoiTypes(new Set(defaultEnabledPoiTypes))}
						>
							{t('restorePoiTypeDefaults')}
						</Button>
					</div>
				) : (
					<p className="px-1 py-2 text-xs text-gray-500 italic dark:text-[var(--text-secondary)]">
						{poisFile?.pois?.length ? t('listEmptyFiltered') : t('searchLoading')}
					</p>
				))}
			{groupedItems
				? groupedItems.map((item) => {
						if (item.type === 'header') {
							return (
								<div
									className="sticky top-0 z-10 mt-1 bg-[var(--map-tooltip-bg)] px-1 py-1 text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase dark:bg-[var(--bg-primary)] dark:text-[var(--text-secondary)]"
									key={item.key}
								>
									{item.label} · {t('groupCount', { count: item.count })}
								</div>
							);
						}
						return renderRow(item.poi, item.idx);
					})
				: rows.map((poi, i) => renderRow(poi, i))}
		</div>
	);
}
