'use client';

import React, { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
	displayToKg,
	displayToLph,
	foodRateUnitLabel,
	formatWeight,
	kgToDisplay,
	lphToDisplay,
	PACK_ETA_REFERENCE_KG,
	volumeUnitLabel,
	weightUnitLabel,
} from '@/lib/pack-weight';
import { parsePackCsv } from '@/lib/pack-csv';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { IoCloudUploadOutline } from 'react-icons/io5';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { MAP_CONTROL_INPUT, MAP_CONTROL_LABEL_INPUT_GRID } from '../map-controls-constants';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { SettingsToggleRow } from '../SettingsToggleRow';
import { useShallow } from 'zustand/react/shallow';

/** Pack base weight, water and food consumption, the gear CSV and the pack ETA adjustment. */
export function PackPaceCard(): React.ReactElement {
	const t = useTranslations('mapControls');
	const {
		settingsPanelPackOpen,
		setSettingsPanelPackOpen,
		units,
		packBaseWeightKg,
		setPackBaseWeightKg,
		waterConsumptionLph,
		setWaterConsumptionLph,
		foodConsumptionKgPerDay,
		setFoodConsumptionKgPerDay,
		packGearList,
		setPackGearList,
		packEtaAdjust,
		setPackEtaAdjust,
	} = useMapStore(
		useShallow((s: MapStoreState) => ({
			settingsPanelPackOpen: s.settingsPanelPackOpen,
			setSettingsPanelPackOpen: s.setSettingsPanelPackOpen,
			units: s.units,
			packBaseWeightKg: s.packBaseWeightKg,
			setPackBaseWeightKg: s.setPackBaseWeightKg,
			waterConsumptionLph: s.waterConsumptionLph,
			setWaterConsumptionLph: s.setWaterConsumptionLph,
			foodConsumptionKgPerDay: s.foodConsumptionKgPerDay,
			setFoodConsumptionKgPerDay: s.setFoodConsumptionKgPerDay,
			packGearList: s.packGearList,
			setPackGearList: s.setPackGearList,
			packEtaAdjust: s.packEtaAdjust,
			setPackEtaAdjust: s.setPackEtaAdjust,
		})),
	);
	const packCsvInputRef = useRef<HTMLInputElement>(null);
	const [packCsvError, setPackCsvError] = useState(false);

	const handlePackCsv = async (file: File): Promise<void> => {
		setPackCsvError(false);
		try {
			const list = parsePackCsv(await file.text(), file.name);
			setPackGearList(list);
			setPackBaseWeightKg(list.baseKg);
		} catch {
			setPackCsvError(true);
		}
	};

	return (
		<MapControlSectionCard
			collapsible
			open={settingsPanelPackOpen}
			title={t('sections.packPace')}
			onOpenChange={setSettingsPanelPackOpen}
		>
			<div className="flex flex-col gap-1.5">
				<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('packWeightTitle')}</span>
				<div className={MAP_CONTROL_LABEL_INPUT_GRID}>
					<label className="text-xs text-gray-600 dark:text-[var(--text-secondary)]" htmlFor="pack-base-weight">
						{t('packBaseWeightLabel')}
					</label>
					<input
						className={cn(MAP_CONTROL_INPUT, 'w-full text-right tabular-nums')}
						id="pack-base-weight"
						min={0}
						step={0.1}
						type="number"
						value={packBaseWeightKg === null ? '' : Math.round(kgToDisplay(packBaseWeightKg, units) * 10) / 10}
						onChange={(e) => {
							if (e.target.value === '') {
								setPackBaseWeightKg(null);
								return;
							}
							const v = Number(e.target.value);
							if (Number.isFinite(v) && v >= 0) setPackBaseWeightKg(displayToKg(v, units));
						}}
					/>
					<span className="text-xs whitespace-nowrap text-gray-600 dark:text-[var(--text-secondary)]">
						{weightUnitLabel(units)}
					</span>
					<label className="text-xs text-gray-600 dark:text-[var(--text-secondary)]" htmlFor="pack-water-consumption">
						{t('waterConsumptionLabel')}
					</label>
					<input
						className={cn(MAP_CONTROL_INPUT, 'w-full text-right tabular-nums')}
						id="pack-water-consumption"
						min={0.1}
						step={0.1}
						type="number"
						value={Math.round(lphToDisplay(waterConsumptionLph, units) * 100) / 100}
						onChange={(e) => {
							const v = Number(e.target.value);
							if (Number.isFinite(v) && v > 0) setWaterConsumptionLph(displayToLph(v, units));
						}}
					/>
					<span className="text-xs whitespace-nowrap text-gray-600 dark:text-[var(--text-secondary)]">
						{volumeUnitLabel(units)}/h
					</span>
					<label className="text-xs text-gray-600 dark:text-[var(--text-secondary)]" htmlFor="pack-food-consumption">
						{t('foodConsumptionLabel')}
					</label>
					<input
						className={cn(MAP_CONTROL_INPUT, 'w-full text-right tabular-nums')}
						id="pack-food-consumption"
						min={0.1}
						step={0.1}
						type="number"
						value={Math.round(kgToDisplay(foodConsumptionKgPerDay, units) * 100) / 100}
						onChange={(e) => {
							const v = Number(e.target.value);
							if (Number.isFinite(v) && v > 0) setFoodConsumptionKgPerDay(displayToKg(v, units));
						}}
					/>
					<span className="text-xs whitespace-nowrap text-gray-600 dark:text-[var(--text-secondary)]">
						{foodRateUnitLabel(units)}
					</span>
				</div>
				<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('packWeightHint')}</p>
				<input
					accept=".csv,text/csv"
					className="hidden"
					ref={packCsvInputRef}
					type="file"
					onChange={(e) => {
						const file = e.target.files?.[0];
						if (file) void handlePackCsv(file);
						e.target.value = '';
					}}
				/>
				{packGearList ? (
					<div className="flex items-center gap-2 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
						<span className="min-w-0 flex-1 truncate">
							{t('packCsvSummary', {
								name: packGearList.sourceName,
								count: packGearList.items.length,
								base: formatWeight(packGearList.baseKg, units),
							})}
						</span>
						<Button size="sm" variant="base" onClick={() => setPackGearList(null)}>
							{t('packCsvClear')}
						</Button>
					</div>
				) : (
					<Button
						className="h-8 w-fit"
						size="sm"
						variant="mapControlOutlineSecondary"
						onClick={() => packCsvInputRef.current?.click()}
					>
						<IoCloudUploadOutline aria-hidden className="mr-1.5 h-3.5 w-3.5 shrink-0" />
						{t('packCsvImport')}
					</Button>
				)}
				{packCsvError && <p className="text-cldt-red m-0 text-xs">{t('packCsvError')}</p>}
			</div>

			<SettingsToggleRow
				checked={packEtaAdjust}
				hint={t('packEtaAdjustHint', { reference: formatWeight(PACK_ETA_REFERENCE_KG, units) })}
				label={t('packEtaAdjustLabel')}
				onCheckedChange={(checked) => setPackEtaAdjust(checked)}
			/>
		</MapControlSectionCard>
	);
}
