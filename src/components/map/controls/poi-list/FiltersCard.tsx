'use client';

import React from 'react';
import { IoCreateOutline, IoTrashOutline } from 'react-icons/io5';
import { type MultiValue } from 'react-select';
import { WATER_COLOR, type WaterReliability } from '@/lib/water-intelligence';
import { Checkbox } from '@/components/ui/Checkbox';
import { MAP_CONTROL_INLINE_LINK } from '../map-controls-constants';
import { MapControlIconButton } from '../MapControlIconButton';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { MapControlMultiSelect, MapControlSelectColorDotLabel, MapControlSingleSelect } from '../MapControlSelect';
import { MapControlInlineNameForm } from '../MapControlInlineNameForm';
import type { PoiListData } from './usePoiListData';

/** Type, water reliability and reachability filters, with saved presets. */
export function FiltersCard({ data }: { data: PoiListData }): React.ReactElement {
	const {
		applyPoiFilterPreset,
		deletePoiFilterPreset,
		enabledWaterReliability,
		filterPresetOptions,
		handleRenameFilterPreset,
		handleSaveFilterPreset,
		hiddenByReachabilityCount,
		includeRemotePois,
		poiFilterPresets,
		poiListFiltersOpen,
		presetNameInput,
		renamePresetInput,
		renamingPresetId,
		savingFilterPreset,
		selectedTypeOptions,
		selectedWaterReliabilityOptions,
		setEnabledPoiTypes,
		setEnabledWaterReliability,
		setIncludeRemotePois,
		setPoiListFiltersOpen,
		setPresetNameInput,
		setRenamePresetInput,
		setRenamingPresetId,
		setSavingFilterPreset,
		showWaterReliabilityFilter,
		t,
		typeCounts,
		typeOptions,
		waterReliabilityOptions,
	} = data;

	return (
		<MapControlSectionCard
			collapsible
			open={poiListFiltersOpen}
			title={t('sections.filters')}
			onOpenChange={setPoiListFiltersOpen}
		>
			<MapControlMultiSelect<{ value: string; label: string }>
				aria-label={t('typeFilterPlaceholder')}
				formatOptionLabel={(option, meta) =>
					meta.context === 'menu' && typeCounts ? (
						<span>
							{option.label}{' '}
							<span className="text-gray-400 tabular-nums dark:text-[var(--text-secondary)]">
								({typeCounts[option.value] ?? 0})
							</span>
						</span>
					) : (
						option.label
					)
				}
				// Counts only in the open menu (context 'menu'), so the selected
				// chips stay compact. Falls back to the plain label while the
				// manifest is loading or unavailable.
				noOptionsMessage={() => t('typeFilterNoMatches')}
				options={typeOptions}
				placeholder={t('typeFilterPlaceholder')}
				value={selectedTypeOptions}
				onChange={(val: MultiValue<{ value: string; label: string }>) =>
					setEnabledPoiTypes(new Set(val.map((o) => o.value)))
				}
			/>

			<div className="flex flex-col gap-1">
				<div className="flex items-center justify-between text-[0.625rem] tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
					<span>{t('filterPresetsHeading')}</span>
					{!savingFilterPreset && (
						<button className={MAP_CONTROL_INLINE_LINK} type="button" onClick={() => setSavingFilterPreset(true)}>
							{t('filterPresetsSave')}
						</button>
					)}
				</div>
				{filterPresetOptions.length > 0 && (
					<MapControlSingleSelect<{ value: string; label: string }>
						aria-label={t('filterPresetsApply')}
						options={filterPresetOptions}
						placeholder={t('filterPresetsApply')}
						value={null}
						onChange={(val) => {
							if (val) applyPoiFilterPreset(val.value);
						}}
					/>
				)}
				{poiFilterPresets.map((preset) =>
					renamingPresetId === preset.id ? (
						<MapControlInlineNameForm
							ariaLabel={t('filterPresetsNamePlaceholder')}
							cancelLabel={t('filterPresetsCancel')}
							confirmLabel={t('filterPresetsConfirm')}
							key={preset.id}
							placeholder={t('filterPresetsNamePlaceholder')}
							value={renamePresetInput}
							onCancel={() => {
								setRenamingPresetId(null);
								setRenamePresetInput('');
							}}
							onChange={setRenamePresetInput}
							onConfirm={handleRenameFilterPreset}
						/>
					) : (
						<div className="flex items-center justify-between gap-1 text-xs" key={preset.id}>
							<button
								className="text-cldt-blue focus-visible:ring-cldt-green truncate text-left hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
								type="button"
								onClick={() => applyPoiFilterPreset(preset.id)}
							>
								{preset.name}
							</button>
							<div className="flex shrink-0 items-center gap-0.5">
								<MapControlIconButton
									aria-label={t('filterPresetsRename', { name: preset.name })}
									onClick={() => {
										setRenamingPresetId(preset.id);
										setRenamePresetInput(preset.name);
									}}
								>
									<IoCreateOutline aria-hidden className="h-3.5 w-3.5" />
								</MapControlIconButton>
								<MapControlIconButton
									aria-label={t('filterPresetsDelete', { name: preset.name })}
									onClick={() => deletePoiFilterPreset(preset.id)}
								>
									<IoTrashOutline aria-hidden className="h-3.5 w-3.5" />
								</MapControlIconButton>
							</div>
						</div>
					),
				)}
				{savingFilterPreset && (
					<MapControlInlineNameForm
						ariaLabel={t('filterPresetsNamePlaceholder')}
						cancelLabel={t('filterPresetsCancel')}
						confirmLabel={t('filterPresetsConfirm')}
						placeholder={t('filterPresetsNamePlaceholder')}
						value={presetNameInput}
						onCancel={() => {
							setSavingFilterPreset(false);
							setPresetNameInput('');
						}}
						onChange={setPresetNameInput}
						onConfirm={handleSaveFilterPreset}
					/>
				)}
			</div>

			{hiddenByReachabilityCount > 0 && (
				<label className="flex cursor-pointer items-start gap-2">
					<Checkbox checked={includeRemotePois} onCheckedChange={setIncludeRemotePois} />
					<div className="flex flex-col gap-0.5">
						<span className="text-xs text-gray-700 dark:text-[var(--text-primary)]">{t('includeRemotePoisLabel')}</span>
						<span className="text-[0.625rem] text-gray-500 dark:text-[var(--text-secondary)]">
							{t('includeRemotePoisHint')}
						</span>
					</div>
				</label>
			)}

			{showWaterReliabilityFilter && (
				<MapControlMultiSelect<{ value: WaterReliability; label: string }>
					aria-label={t('waterReliabilityFilterHeading')}
					formatOptionLabel={(option) => (
						<MapControlSelectColorDotLabel color={WATER_COLOR[option.value]} label={option.label} />
					)}
					isSearchable={false}
					options={waterReliabilityOptions}
					placeholder={t('waterReliabilityFilterPlaceholder')}
					value={selectedWaterReliabilityOptions}
					onChange={(val: MultiValue<{ value: WaterReliability; label: string }>) =>
						setEnabledWaterReliability(new Set((val ?? []).map((o) => o.value)))
					}
				/>
			)}

			{showWaterReliabilityFilter && enabledWaterReliability.size === 0 && (
				<p className="m-0 text-[0.625rem] text-gray-500 dark:text-[var(--text-secondary)]">
					{t('waterReliabilityFilterHint')}
				</p>
			)}
		</MapControlSectionCard>
	);
}
