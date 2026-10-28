'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { IoLocationOutline } from 'react-icons/io5';
import { cn } from '@/lib/cn';
import { Checkbox } from '@/components/ui/Checkbox';
import { MAP_CONTROL_INPUT, MAP_CONTROL_PANEL_WIDTH, MAP_CONTROL_POPOVER } from '../map-controls-constants';
import { MapControlsButton } from '../MapControlsButton';
import { MapControlsPoiDisclaimerModal } from '../MapControlsPoiDisclaimerModal';
import { usePoiListData } from './usePoiListData';
import { FiltersCard } from './FiltersCard';
import { SortCard } from './SortCard';
import { TagsCard } from './TagsCard';
import { PoiListBody } from './PoiListBody';
import { StarsCard } from './StarsCard';
import { ExportCard } from './ExportCard';

interface PoiListPanelProps {
	containerRef: React.RefObject<HTMLDivElement | null>;
	isExpanded: boolean;
	onToggle: () => void;
	/** Must be a stable reference (wrapped in useCallback at the call site), so
	 *  the pickHandlers useMemo inside does not rebuild on every parent render. */
	onClose: () => void;
}

/**
 * Scrollable list of all currently visible POIs. "Visible" matches the same
 * filter PoiMarkers uses: master layer toggle + per-type enabled set. Rows
 * are sortable by trail km (default, direction-aware), name (locale-folded),
 * or distance from the trail.
 *
 * Clicking a row flies the map to the POI at a marker-friendly zoom (past
 * the cluster threshold) so the corresponding marker is materialized and
 * its popup can be opened by the user from the map.
 */
export function PoiListPanel({ containerRef, isExpanded, onToggle, onClose }: PoiListPanelProps): React.ReactElement {
	const data = usePoiListData({ isExpanded, onClose });
	const {
		disclaimerOpen,
		handleJump,
		handleKeyDown,
		handlePoisLayerToggle,
		jumpLabel,
		parsedDistance,
		poisLayerEnabled,
		popoverRef,
		query,
		rows,
		searchInputRef,
		seedDefaultFiltersIfPristine,
		setDisclaimerOpen,
		setPoiDisclaimerDismissedAt,
		setPoisLayerEnabled,
		setQuery,
		t,
	} = data;

	const popoverContent = (
		<div
			aria-labelledby="poi-list-title"
			aria-modal="true"
			className={cn(
				MAP_CONTROL_POPOVER,
				`z-modal fixed top-2 right-16 flex max-h-[calc(100dvh-4rem)] ${MAP_CONTROL_PANEL_WIDTH} flex-col gap-2 overflow-hidden`,
			)}
			ref={popoverRef}
			role="dialog"
			onKeyDown={handleKeyDown}
			onMouseDown={(e) => e.stopPropagation()}
			onTouchStart={(e) => e.stopPropagation()}
		>
			<div className="flex shrink-0 items-center justify-between gap-2">
				<h3 className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]" id="poi-list-title">
					{t('listTitle')}
				</h3>
				<label
					className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-600 dark:text-[var(--text-secondary)]"
					title={t('layerToggleShort')}
				>
					<Checkbox checked={poisLayerEnabled} onCheckedChange={handlePoisLayerToggle} />
					<span>{t('layerToggleShort')}</span>
				</label>
			</div>

			<input
				aria-label={t('searchAriaLabel')}
				className={cn(MAP_CONTROL_INPUT, 'w-full shrink-0')}
				placeholder={t('searchPlaceholderUnified')}
				ref={searchInputRef}
				type="search"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
			/>

			{parsedDistance && jumpLabel && (
				<button
					className="border-cldt-blue/30 bg-cldt-blue/5 hover:bg-cldt-blue/10 focus-visible:bg-cldt-blue/10 dark:bg-cldt-blue/15 focus-visible:ring-cldt-green flex w-full shrink-0 flex-col items-start gap-0 rounded border px-2 py-1.5 text-left text-sm focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
					type="button"
					onClick={() => handleJump(parsedDistance)}
				>
					<span className="text-cldt-blue font-medium dark:text-[var(--text-primary)]">{jumpLabel}</span>
					{rows.length > 0 && (
						<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
							{t('nearbyHint', { count: rows.length })}
						</span>
					)}
				</button>
			)}

			<div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
				<div className="flex flex-col gap-2">
					<FiltersCard data={data} />

					<SortCard data={data} />

					<TagsCard data={data} />

					<PoiListBody data={data} />

					<StarsCard data={data} />

					<ExportCard data={data} />
				</div>
			</div>
		</div>
	);

	return (
		<div className="relative inline-block w-10 shrink-0" ref={containerRef}>
			<MapControlsButton
				active={isExpanded}
				ariaLabel={t('listAriaLabel')}
				content={t('listTitle')}
				title={t('listTitle')}
				onClick={onToggle}
			>
				<IoLocationOutline aria-hidden className="h-5 w-5" />
			</MapControlsButton>
			{isExpanded && typeof document !== 'undefined' && createPortal(popoverContent, document.body)}
			{typeof document !== 'undefined' &&
				createPortal(
					<MapControlsPoiDisclaimerModal
						open={disclaimerOpen}
						onCancel={() => setDisclaimerOpen(false)}
						onConfirm={() => {
							seedDefaultFiltersIfPristine();
							setPoisLayerEnabled(true);
							setDisclaimerOpen(false);
						}}
						onDismissFor30Days={() => {
							seedDefaultFiltersIfPristine();
							setPoisLayerEnabled(true);
							setPoiDisclaimerDismissedAt(Date.now());
							setDisclaimerOpen(false);
						}}
					/>,
					document.body,
				)}
		</div>
	);
}
