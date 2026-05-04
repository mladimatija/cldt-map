'use client';

import React, { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMap } from 'react-leaflet';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { cn, formatElevation, kmToMiles, milesToKm } from '@/lib/utils';
import { MAP_CONTROL_POPOVER, MAP_CONTROL_INPUT } from './map-controls-constants';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { usePopoverFocusTrap } from '@/hooks';
import { splitByDistance, splitByEta, computeStageStats } from '@/lib/stage-planner';
import { findNearestPointIndex, formatEta } from '@/lib/distance-utils';
import { extractGpxSegment, downloadGpxFile } from '@/lib/gpx-export';

const MAX_STAGES = 200;

export function MapControlsStagePlannerPanel(): React.ReactElement {
	const t = useTranslations('stagePlanner');

	const stagePlan = useMapStore((s: MapStoreState) => s.stagePlan);
	const setStagePlan = useMapStore((s: MapStoreState) => s.setStagePlan);
	const clearStagePlan = useMapStore((s: MapStoreState) => s.clearStagePlan);
	const walkingPaceKmh = useMapStore((s: MapStoreState) => s.walkingPaceKmh);
	const gradeAdjustedEta = useMapStore((s: MapStoreState) => s.gradeAdjustedEta);
	const units = useMapStore((s: MapStoreState) => s.units);

	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);
	const trailMetadata = useStore((s: StoreState) => s.trailMetadata);
	const rawGpxData = useStore((s: StoreState) => s.rawGpxData);

	const map = useMap();
	const popoverRef = usePopoverFocusTrap(true);

	const isImperial = units === 'imperial';

	const [startKm, setStartKm] = useState(0);
	const [endKm, setEndKm] = useState(() =>
		trailMetadata?.totalDistance ? Math.round(trailMetadata.totalDistance / 1000) : 0,
	);
	const [mode, setMode] = useState<'kmPerDay' | 'stages'>('kmPerDay');
	const [value, setValue] = useState(25);
	const [balanceByEta, setBalanceByEta] = useState(false);
	const [activeStageIndex, setActiveStageIndex] = useState<number | null>(null);
	const [confirmReset, setConfirmReset] = useState(false);

	const toDisplay = (km: number): number => (isImperial ? Math.round(kmToMiles(km) * 10) / 10 : km);
	const fromDisplay = (display: number): number => (isImperial ? milesToKm(display) : display);

	const stageStats = useMemo(() => {
		if (!stagePlan || !enhancedTrailPoints?.length) return [];
		return stagePlan.stages.map((stage) =>
			computeStageStats(stage, enhancedTrailPoints, enhancedTrailPoints, walkingPaceKmh, gradeAdjustedEta),
		);
	}, [stagePlan, enhancedTrailPoints, walkingPaceKmh, gradeAdjustedEta]);

	const handleGenerate = (): void => {
		if (!enhancedTrailPoints?.length) return;
		const stageKm = isImperial ? milesToKm(Math.max(0.1, value)) : Math.max(0.1, value);
		if (balanceByEta) {
			const stageCount =
				mode === 'stages'
					? Math.min(MAX_STAGES, Math.max(1, Math.round(value)))
					: Math.min(MAX_STAGES, Math.max(1, Math.ceil((endKm - startKm) / stageKm)));
			setStagePlan(splitByEta(enhancedTrailPoints, startKm, endKm, walkingPaceKmh, gradeAdjustedEta, stageCount));
		} else if (mode === 'stages') {
			const stageCount = Math.min(MAX_STAGES, Math.max(1, Math.round(value)));
			const evenKm = (endKm - startKm) / stageCount;
			setStagePlan(splitByDistance(startKm, endKm, evenKm));
		} else {
			setStagePlan(splitByDistance(startKm, endKm, stageKm));
		}
		setActiveStageIndex(0);
		setConfirmReset(false);
	};

	const handleStageClick = (index: number): void => {
		setActiveStageIndex(index);
		if (!stagePlan || !enhancedTrailPoints?.length) return;
		const stage = stagePlan.stages[index];
		const startM = stage.startKm * 1000;
		const endM = stage.endKm * 1000;
		const startIdx = findNearestPointIndex(enhancedTrailPoints, startM);
		const endIdx = findNearestPointIndex(enhancedTrailPoints, endM);
		const pts = enhancedTrailPoints.slice(startIdx, endIdx + 1);
		if (pts.length < 2) return;
		let minLat = pts[0].lat,
			maxLat = pts[0].lat,
			minLng = pts[0].lng,
			maxLng = pts[0].lng;
		for (const p of pts) {
			if (p.lat < minLat) minLat = p.lat;
			if (p.lat > maxLat) maxLat = p.lat;
			if (p.lng < minLng) minLng = p.lng;
			if (p.lng > maxLng) maxLng = p.lng;
		}
		map.fitBounds(
			[
				[minLat, minLng],
				[maxLat, maxLng],
			],
			{ padding: [50, 50] },
		);
	};

	const handleGpxExport = (): void => {
		if (activeStageIndex === null || !stagePlan || !rawGpxData || !enhancedTrailPoints?.length) return;
		const stage = stagePlan.stages[activeStageIndex];
		const startIdx = findNearestPointIndex(enhancedTrailPoints, stage.startKm * 1000);
		const endIdx = findNearestPointIndex(enhancedTrailPoints, stage.endKm * 1000);
		const gpx = extractGpxSegment(rawGpxData, startIdx, endIdx, `CLDT Stage ${activeStageIndex + 1}`);
		downloadGpxFile(gpx, `cldt-stage-${activeStageIndex + 1}.gpx`);
	};

	const handleConfirmReset = (): void => {
		clearStagePlan();
		setActiveStageIndex(null);
		setConfirmReset(false);
	};

	const distanceUnitLabel = isImperial ? 'mi' : 'km';
	const valueUnitLabel = mode === 'stages' ? t('modeStages') : `${distanceUnitLabel}/day`;

	return (
		<div
			aria-labelledby="stage-planner-title"
			aria-modal="true"
			className={`z-controls-popover absolute top-1/2 right-[calc(100%+0.5rem)] flex w-80 -translate-y-1/2 flex-col gap-2 ${MAP_CONTROL_POPOVER}`}
			ref={popoverRef}
			role="dialog"
			onContextMenu={(e) => e.preventDefault()}
		>
			<h3 className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]" id="stage-planner-title">
				{t('title')}
			</h3>

			<div className="flex flex-col gap-2">
				<div className="flex gap-2">
					<label className="flex flex-1 flex-col gap-0.5 text-xs text-gray-600 dark:text-gray-400">
						{t('startKm')} ({distanceUnitLabel})
						<input
							className={MAP_CONTROL_INPUT}
							min={0}
							type="number"
							value={toDisplay(startKm)}
							onChange={(e) => {
								const v = Number(e.target.value);
								if (Number.isFinite(v)) setStartKm(fromDisplay(v));
							}}
						/>
					</label>
					<label className="flex flex-1 flex-col gap-0.5 text-xs text-gray-600 dark:text-gray-400">
						{t('endKm')} ({distanceUnitLabel})
						<input
							className={MAP_CONTROL_INPUT}
							min={0}
							type="number"
							value={toDisplay(endKm)}
							onChange={(e) => {
								const v = Number(e.target.value);
								if (Number.isFinite(v)) setEndKm(fromDisplay(v));
							}}
						/>
					</label>
				</div>

				<div className="flex gap-3 text-xs text-gray-600 dark:text-gray-400">
					<label className="flex cursor-pointer items-center gap-1">
						<input
							checked={mode === 'kmPerDay'}
							name="stage-mode"
							type="radio"
							value="kmPerDay"
							onChange={() => setMode('kmPerDay')}
						/>
						{t('modeKmPerDay')}
					</label>
					<label className="flex cursor-pointer items-center gap-1">
						<input
							checked={mode === 'stages'}
							name="stage-mode"
							type="radio"
							value="stages"
							onChange={() => setMode('stages')}
						/>
						{t('modeStages')}
					</label>
				</div>

				<label className="flex flex-col gap-0.5 text-xs text-gray-600 dark:text-gray-400">
					{valueUnitLabel}
					<input
						className={MAP_CONTROL_INPUT}
						min={mode === 'stages' ? 1 : 0.1}
						step={mode === 'stages' ? 1 : isImperial ? 0.5 : 1}
						type="number"
						value={value}
						onChange={(e) => {
							const v = Number(e.target.value);
							if (Number.isFinite(v) && v > 0) setValue(v);
						}}
					/>
				</label>

				<label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
					<Checkbox
						checked={balanceByEta}
						onCheckedChange={(checked) => {
							setBalanceByEta(checked);
							if (checked) setMode('stages');
						}}
					/>
					{t('balanceByEta')}
				</label>

				<Button variant="mapControlOutline" onClick={handleGenerate}>
					{t('generatePlan')}
				</Button>
			</div>

			{!stagePlan && <p className="text-xs text-gray-500 dark:text-gray-400">{t('noStages')}</p>}

			{stagePlan && (
				<div className="flex max-h-[60vh] flex-col divide-y divide-gray-100 overflow-y-auto rounded border border-gray-100 dark:divide-[var(--border-color)] dark:border-[var(--border-color)]">
					{stagePlan.stages.map((stage, i) => {
						const stats = stageStats[i];
						return (
							<button
								className={cn(
									'focus-visible:ring-cldt-green flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
									i === activeStageIndex
										? 'bg-cldt-light-blue text-gray-900 dark:text-white'
										: 'hover:bg-gray-50 dark:hover:bg-gray-700',
								)}
								key={`${stage.startKm}-${stage.endKm}`}
								type="button"
								onClick={() => handleStageClick(i)}
							>
								<span className="w-6 shrink-0 font-medium">{i + 1}</span>
								<span className="min-w-0 flex-1 truncate text-gray-500 dark:text-gray-400">
									{toDisplay(stage.startKm).toFixed(0)}–{toDisplay(stage.endKm).toFixed(0)} {distanceUnitLabel}
								</span>
								{stats && (
									<>
										<span className="shrink-0 text-green-600 dark:text-green-400">
											↑{formatElevation(stats.gainM, units)}
										</span>
										<span className="shrink-0 text-red-500 dark:text-red-400">
											↓{formatElevation(stats.lossM, units)}
										</span>
										<span className="shrink-0 text-gray-500 tabular-nums dark:text-gray-400">
											{formatEta(stats.etaSec)}
										</span>
									</>
								)}
							</button>
						);
					})}
				</div>
			)}

			{stagePlan && !confirmReset && (
				<div className="flex flex-col gap-2">
					<Button disabled={activeStageIndex === null} variant="mapControlOutline" onClick={handleGpxExport}>
						{t('gpxExport')}
					</Button>
					<Button variant="mapControlOutlineSecondary" onClick={() => setConfirmReset(true)}>
						{t('reset')}
					</Button>
				</div>
			)}

			{stagePlan && confirmReset && (
				<div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
					<span className="flex-1">{t('confirmReset')}</span>
					<Button size="sm" variant="mapControlOutlineSecondary" onClick={handleConfirmReset}>
						{t('confirmYes')}
					</Button>
					<Button size="sm" variant="mapControlOutline" onClick={() => setConfirmReset(false)}>
						{t('confirmNo')}
					</Button>
				</div>
			)}
		</div>
	);
}
