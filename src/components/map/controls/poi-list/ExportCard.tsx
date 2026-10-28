'use client';

import React from 'react';
import { Button } from '@/components/ui/Button';
import { MapControlSectionCard } from '../MapControlSectionCard';
import type { PoiListData } from './usePoiListData';

/** GPX export of the selected rows. */
export function ExportCard({ data }: { data: PoiListData }): React.ReactElement | null {
	const { handleExportSelection, poiListExportOpen, rows, selected, setPoiListExportOpen, t } = data;

	if (rows.length === 0) return null;
	return (
		<MapControlSectionCard
			collapsible
			open={poiListExportOpen}
			title={t('sections.export')}
			onOpenChange={setPoiListExportOpen}
		>
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
					{t('exportSelectionCount', { count: selected.size })}
				</span>
				<Button disabled={selected.size === 0} size="sm" variant="mapControlOutline" onClick={handleExportSelection}>
					{t('exportSelectionButton')}
				</Button>
			</div>
		</MapControlSectionCard>
	);
}
