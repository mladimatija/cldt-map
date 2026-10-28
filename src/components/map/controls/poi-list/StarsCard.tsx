'use client';

import React from 'react';
import { IoCreateOutline, IoTrashOutline } from 'react-icons/io5';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { MAP_CONTROL_INLINE_LINK } from '../map-controls-constants';
import { MapControlIconButton } from '../MapControlIconButton';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { MapControlSingleSelect } from '../MapControlSelect';
import { MapControlInlineNameForm } from '../MapControlInlineNameForm';
import type { PoiListData } from './usePoiListData';

/** Star collections: switch, create, rename and delete. */
export function StarsCard({ data }: { data: PoiListData }): React.ReactElement {
	const {
		activeStarredCollectionId,
		activeStarredPoiIds,
		clearStarredPois,
		collectionNameInput,
		creatingStarCollection,
		deleteStarredPoiCollection,
		displayStarCollectionName,
		handleCreateStarCollection,
		handleRenameStarCollection,
		poiListStarsOpen,
		renameCollectionInput,
		renamingCollectionId,
		selectedStarCollectionOption,
		setActiveStarredCollectionId,
		setCollectionNameInput,
		setCreatingStarCollection,
		setPoiListStarsOpen,
		setRenameCollectionInput,
		setRenamingCollectionId,
		starCollectionOptions,
		starredPoiCollections,
		t,
	} = data;

	return (
		<MapControlSectionCard
			collapsible
			open={poiListStarsOpen}
			title={t('sections.stars')}
			onOpenChange={setPoiListStarsOpen}
		>
			<div className="flex flex-col gap-1.5">
				<div className="flex flex-col gap-1">
					<div className="flex items-center justify-between text-[0.625rem] tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
						<span>{t('starCollectionHeading')}</span>
						{!creatingStarCollection && (
							<button className={MAP_CONTROL_INLINE_LINK} type="button" onClick={() => setCreatingStarCollection(true)}>
								{t('starCollectionNew')}
							</button>
						)}
					</div>
					{starCollectionOptions.length > 0 && (
						<MapControlSingleSelect<{ value: string; label: string }>
							aria-label={t('starCollectionSelect')}
							options={starCollectionOptions}
							placeholder={t('starCollectionSelect')}
							value={selectedStarCollectionOption}
							onChange={(val) => {
								if (val) setActiveStarredCollectionId(val.value);
							}}
						/>
					)}
					{starredPoiCollections.map((collection) => {
						const collectionLabel = displayStarCollectionName(collection.name);
						return renamingCollectionId === collection.id ? (
							<MapControlInlineNameForm
								ariaLabel={t('starCollectionNamePlaceholder')}
								cancelLabel={t('starCollectionCancel')}
								confirmLabel={t('filterPresetsConfirm')}
								key={collection.id}
								placeholder={t('starCollectionNamePlaceholder')}
								value={renameCollectionInput}
								onCancel={() => {
									setRenamingCollectionId(null);
									setRenameCollectionInput('');
								}}
								onChange={setRenameCollectionInput}
								onConfirm={handleRenameStarCollection}
							/>
						) : (
							<div className="flex items-center justify-between gap-1 text-xs" key={collection.id}>
								<button
									className={cn(
										'focus-visible:ring-cldt-green truncate text-left hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
										collection.id === activeStarredCollectionId
											? 'text-amber-600 dark:text-amber-400'
											: 'text-cldt-blue',
									)}
									type="button"
									onClick={() => setActiveStarredCollectionId(collection.id)}
								>
									{collectionLabel} ({collection.poiIds.length})
								</button>
								<div className="flex shrink-0 items-center gap-0.5">
									<MapControlIconButton
										aria-label={t('starCollectionRename', { name: collectionLabel })}
										onClick={() => {
											setRenamingCollectionId(collection.id);
											setRenameCollectionInput(collection.name);
										}}
									>
										<IoCreateOutline aria-hidden className="h-3.5 w-3.5" />
									</MapControlIconButton>
									<MapControlIconButton
										aria-label={t('starCollectionDelete', { name: collectionLabel })}
										onClick={() => {
											if (renamingCollectionId === collection.id) {
												setRenamingCollectionId(null);
												setRenameCollectionInput('');
											}
											deleteStarredPoiCollection(collection.id);
										}}
									>
										<IoTrashOutline aria-hidden className="h-3.5 w-3.5" />
									</MapControlIconButton>
								</div>
							</div>
						);
					})}
					{creatingStarCollection && (
						<MapControlInlineNameForm
							ariaLabel={t('starCollectionNamePlaceholder')}
							cancelLabel={t('starCollectionCancel')}
							confirmLabel={t('starCollectionConfirm')}
							placeholder={t('starCollectionNamePlaceholder')}
							value={collectionNameInput}
							onCancel={() => {
								setCreatingStarCollection(false);
								setCollectionNameInput('');
							}}
							onChange={setCollectionNameInput}
							onConfirm={handleCreateStarCollection}
						/>
					)}
				</div>
				{activeStarredPoiIds.size > 0 && (
					<div className="flex items-center justify-between gap-2">
						<span className="text-xs text-amber-600 dark:text-amber-400">
							{t('starredCount', { count: activeStarredPoiIds.size })}
						</span>
						<Button size="sm" variant="mapControlOutlineSecondary" onClick={clearStarredPois}>
							{t('clearStarred')}
						</Button>
					</div>
				)}
			</div>
		</MapControlSectionCard>
	);
}
