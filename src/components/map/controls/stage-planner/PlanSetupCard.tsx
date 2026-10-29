'use client';

import React from 'react';
import { IoTrashOutline } from 'react-icons/io5';
import { Button } from '@/components/ui/Button';
import { Radio } from '@/components/ui/Radio';
import { MapControlIconButton } from '../MapControlIconButton';
import { MapControlInlineNameForm } from '../MapControlInlineNameForm';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { SettingsToggleRow } from '../SettingsToggleRow';
import { cn } from '@/lib/cn';
import {
	MAP_CONTROL_FOOTNOTE_LINK,
	MAP_CONTROL_INPUT,
	MAP_CONTROL_LABEL_INPUT_GRID,
	MAP_CONTROL_LINK_BUTTON,
} from '../map-controls-constants';
import type { StagePlannerData } from './useStagePlannerData';

/** Plan setup: range, split mode, pace cap, start date, presets and generate. */
export function PlanSetupCard({ data }: { data: StagePlannerData }): React.ReactElement {
	const {
		aheadHorizonLabel,
		applyStagePreset,
		autoBumpNotice,
		balanceByEta,
		deleteStagePlanPreset,
		distanceUnitLabel,
		endKm,
		fromDisplay,
		handleGenerate,
		handleSaveStagePreset,
		handleTripStartDateChange,
		hasTrailAnchor,
		isImperial,
		isSavingStagePreset,
		kmPerDayKm,
		maxHoursPerDay,
		mode,
		openHelpToPlanning,
		requestPoiListAhead,
		setBalanceByEta,
		setEndKm,
		setIsSavingStagePreset,
		setKmPerDayKm,
		setMaxHoursPerDay,
		setMode,
		setStageCount,
		setStagePlannerSetupOpen,
		setStagePresetName,
		setStartKm,
		showMaxHoursRow,
		stageCount,
		stagePlannerSetupOpen,
		stagePlanPresets,
		stagePresetName,
		startKm,
		t,
		toDisplay,
		trailMetadata,
		tripStartDate,
		valueUnitLabel,
		walkingPaceKmh,
	} = data;

	return (
		<MapControlSectionCard
			collapsible
			open={stagePlannerSetupOpen}
			title={t('sections.planSetup')}
			onOpenChange={setStagePlannerSetupOpen}
		>
			<div className={MAP_CONTROL_LABEL_INPUT_GRID}>
				<label className="text-xs text-gray-600 dark:text-[var(--text-secondary)]" htmlFor="stage-start-km">
					{t('startLabel')}
				</label>
				<input
					className={cn(MAP_CONTROL_INPUT, 'w-full text-right tabular-nums')}
					id="stage-start-km"
					max={toDisplay(endKm)}
					min={0}
					type="number"
					value={toDisplay(startKm)}
					onChange={(e) => {
						const v = Number(e.target.value);
						if (Number.isFinite(v)) setStartKm(fromDisplay(v));
					}}
				/>
				<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{distanceUnitLabel}</span>
				<label className="text-xs text-gray-600 dark:text-[var(--text-secondary)]" htmlFor="stage-end-km">
					{t('endLabel')}
				</label>
				<input
					className={cn(MAP_CONTROL_INPUT, 'w-full text-right tabular-nums')}
					id="stage-end-km"
					max={trailMetadata?.totalDistance ? toDisplay(trailMetadata.totalDistance) : undefined}
					min={0}
					type="number"
					value={toDisplay(endKm)}
					onChange={(e) => {
						const v = Number(e.target.value);
						if (Number.isFinite(v)) setEndKm(fromDisplay(v));
					}}
				/>
				<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{distanceUnitLabel}</span>
			</div>

			<div className="flex gap-3 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
				<label className="flex cursor-pointer items-center gap-1">
					<Radio
						checked={mode === 'kmPerDay'}
						name="stage-mode"
						value="kmPerDay"
						onChange={() => setMode('kmPerDay')}
					/>
					{t('modeKmPerDay')}
				</label>
				<label className="flex cursor-pointer items-center gap-1">
					<Radio checked={mode === 'stages'} name="stage-mode" value="stages" onChange={() => setMode('stages')} />
					{t('modeStages')}
				</label>
			</div>

			<div className={MAP_CONTROL_LABEL_INPUT_GRID}>
				<label className="text-xs text-gray-600 dark:text-[var(--text-secondary)]" htmlFor="stage-value">
					{valueUnitLabel}
				</label>
				<input
					className={cn(MAP_CONTROL_INPUT, 'w-full text-right tabular-nums')}
					id="stage-value"
					min={mode === 'stages' ? 1 : 0.1}
					step={mode === 'stages' ? 1 : isImperial ? 0.5 : 1}
					type="number"
					value={mode === 'stages' ? stageCount : toDisplay(kmPerDayKm)}
					onChange={(e) => {
						const v = Number(e.target.value);
						if (!Number.isFinite(v) || v <= 0) return;
						if (mode === 'stages') setStageCount(Math.round(v));
						else setKmPerDayKm(fromDisplay(v));
					}}
				/>
				<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
					{mode === 'stages' ? '' : distanceUnitLabel}
				</span>
			</div>

			{showMaxHoursRow && (
				<div className={MAP_CONTROL_LABEL_INPUT_GRID}>
					<label className="text-xs text-gray-600 dark:text-[var(--text-secondary)]" htmlFor="stage-max-hours">
						{t('maxHoursPerDay')}
					</label>
					<input
						className={cn(MAP_CONTROL_INPUT, 'w-full text-right tabular-nums')}
						id="stage-max-hours"
						max={24}
						min={1}
						step={0.5}
						type="number"
						value={maxHoursPerDay}
						onChange={(e) => {
							const v = Number(e.target.value);
							if (Number.isFinite(v) && v > 0) setMaxHoursPerDay(v);
						}}
					/>
					<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">h</span>
				</div>
			)}

			<SettingsToggleRow
				checked={balanceByEta}
				hint={t('balanceByEtaHint')}
				label={t('balanceByEta')}
				tooltip={t('balanceByEtaHelp')}
				onCheckedChange={(checked) => setBalanceByEta(checked)}
			/>

			<div className="flex flex-col gap-0.5">
				<label className="text-xs text-gray-600 dark:text-[var(--text-secondary)]" htmlFor="stage-trip-start">
					{t('tripStartDate')}
				</label>
				<input
					className={cn(MAP_CONTROL_INPUT, 'w-full')}
					id="stage-trip-start"
					type="date"
					value={tripStartDate}
					onChange={(e) => handleTripStartDateChange(e.target.value)}
				/>
				<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('tripStartDateHint')}</p>
			</div>

			<Button variant="mapControlOutline" onClick={handleGenerate}>
				{t('generatePlan')}
			</Button>

			<div className="flex flex-col gap-1.5 border-t border-gray-100 pt-2 dark:border-[var(--border-color)]">
				<span className="text-xs font-medium text-gray-600 dark:text-[var(--text-secondary)]">
					{t('presetsHeading')}
				</span>
				{stagePlanPresets.length > 0 && (
					<div className="flex flex-col gap-1">
						{stagePlanPresets.map((preset) => (
							<div className="flex items-center gap-1" key={preset.id}>
								<button
									className={cn(MAP_CONTROL_LINK_BUTTON, 'min-w-0 flex-1 truncate')}
									title={preset.name}
									type="button"
									onClick={() => applyStagePreset(preset)}
								>
									{preset.name}
								</button>
								<MapControlIconButton
									aria-label={t('deletePreset', { name: preset.name })}
									title={t('deletePreset', { name: preset.name })}
									onClick={() => deleteStagePlanPreset(preset.id)}
								>
									<IoTrashOutline aria-hidden className="h-3.5 w-3.5" />
								</MapControlIconButton>
							</div>
						))}
					</div>
				)}
				{isSavingStagePreset ? (
					<MapControlInlineNameForm
						ariaLabel={t('presetNameLabel')}
						cancelLabel={t('presetCancel')}
						confirmLabel={t('presetSave')}
						placeholder={t('presetNamePlaceholder')}
						value={stagePresetName}
						onCancel={() => {
							setIsSavingStagePreset(false);
							setStagePresetName('');
						}}
						onChange={setStagePresetName}
						onConfirm={handleSaveStagePreset}
					/>
				) : (
					<Button size="sm" variant="mapControlOutlineSecondary" onClick={() => setIsSavingStagePreset(true)}>
						{t('saveAsPreset')}
					</Button>
				)}
			</div>

			{hasTrailAnchor && (
				<Button
					title={t('previewAheadTooltip', { distance: aheadHorizonLabel })}
					variant="mapControlOutline"
					onClick={() => requestPoiListAhead()}
				>
					{t('previewAhead', { distance: aheadHorizonLabel })}
				</Button>
			)}

			{autoBumpNotice && (
				<p className="text-cldt-blue dark:text-cldt-blue m-0 text-[0.6875rem]">
					{t('autoBumpNotice', {
						actual: autoBumpNotice.actual,
						requested: autoBumpNotice.requested,
						hours: maxHoursPerDay,
						pace: walkingPaceKmh,
					})}
				</p>
			)}

			<button className={MAP_CONTROL_FOOTNOTE_LINK} type="button" onClick={openHelpToPlanning}>
				{t('planningHelp')}
			</button>
		</MapControlSectionCard>
	);
}
