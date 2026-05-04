'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMap, Polyline } from 'react-leaflet';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { cn, formatElevation, kmToMiles, milesToKm } from '@/lib/utils';
import { MAP_CONTROL_POPOVER, MAP_CONTROL_INPUT } from './map-controls-constants';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { usePopoverFocusTrap } from '@/hooks';
import { splitByDistance, splitByEta, computeStageStats } from '@/lib/stage-planner';
import { findNearestPointIndex, formatEta } from '@/lib/distance-utils';
import { buildGpxXml, downloadGpxFile } from '@/lib/gpx-export';
import { exportStripMapPdf, pointsToBounds } from '@/lib/export-utils';

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
	const direction = useStore((s: StoreState) => s.direction);
	const isNobo = direction === 'NOBO';

	const map = useMap();
	const popoverRef = usePopoverFocusTrap(true);

	const isImperial = units === 'imperial';

	const [startKm, setStartKm] = useState(0);
	const [endKm, setEndKm] = useState(() =>
		trailMetadata?.totalDistance ? Math.round(trailMetadata.totalDistance) : 0,
	);
	const [mode, setMode] = useState<'kmPerDay' | 'stages'>('kmPerDay');
	const [kmPerDayKm, setKmPerDayKm] = useState(25);
	const [stageCount, setStageCount] = useState(5);
	const [balanceByEta, setBalanceByEta] = useState(false);
	const [activeStageIndex, setActiveStageIndex] = useState<number | null>(null);
	const [confirmReset, setConfirmReset] = useState(false);
	const [isPdfExporting, setIsPdfExporting] = useState(false);
	const [pdfProgress, setPdfProgress] = useState<{ current: number; total: number } | null>(null);
	const pdfAbortRef = useRef<AbortController | null>(null);

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
		const safeKmPerDay = Math.max(0.1, kmPerDayKm);
		const safeStageCount = Math.min(MAX_STAGES, Math.max(1, stageCount));
		if (balanceByEta) {
			const count =
				mode === 'stages'
					? safeStageCount
					: Math.min(MAX_STAGES, Math.max(1, Math.ceil((endKm - startKm) / safeKmPerDay)));
			setStagePlan(splitByEta(enhancedTrailPoints, startKm, endKm, walkingPaceKmh, gradeAdjustedEta, count));
		} else if (mode === 'stages') {
			setStagePlan(splitByDistance(startKm, endKm, (endKm - startKm) / safeStageCount));
		} else {
			setStagePlan(splitByDistance(startKm, endKm, safeKmPerDay));
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
		const lo = Math.min(startIdx, endIdx);
		const hi = Math.max(startIdx, endIdx);
		const pts = enhancedTrailPoints.slice(lo, hi + 1);
		if (pts.length < 2) return;
		map.fitBounds(pointsToBounds(pts), { padding: [50, 50] });
	};

	const handleGpxExport = (): void => {
		if (activeStageIndex === null || !stagePlan || !enhancedTrailPoints?.length) return;
		const stage = stagePlan.stages[activeStageIndex];
		const startIdx = findNearestPointIndex(enhancedTrailPoints, stage.startKm * 1000);
		const endIdx = findNearestPointIndex(enhancedTrailPoints, stage.endKm * 1000);
		let pts = enhancedTrailPoints.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);
		if (useStore.getState().direction === 'NOBO') pts = [...pts].reverse();
		const gpx = buildGpxXml(
			pts.map((p) => ({ lat: p.lat, lng: p.lng, elevation: p.elevation })),
			`CLDT Stage ${activeStageIndex + 1}`,
		);
		downloadGpxFile(gpx, `cldt-stage-${activeStageIndex + 1}.gpx`);
	};

	const handleStripMapPdfExport = async (): Promise<void> => {
		if (!stagePlan || !enhancedTrailPoints?.length) return;
		const controller = new AbortController();
		pdfAbortRef.current = controller;
		setIsPdfExporting(true);
		setPdfProgress(null);
		try {
			const leafletEl = document.querySelector<HTMLElement>('.leaflet-container') ?? undefined;
			await exportStripMapPdf(
				stagePlan,
				enhancedTrailPoints,
				enhancedTrailPoints,
				walkingPaceKmh,
				gradeAdjustedEta,
				units,
				map,
				(current, total) => setPdfProgress({ current, total }),
				t('pdfStageLabel'),
				leafletEl,
				controller.signal,
				(index) => setActiveStageIndex(index),
				direction,
			);
		} catch (err) {
			console.error('Strip-map PDF export failed:', err instanceof Error ? err.message : String(err));
		} finally {
			pdfAbortRef.current = null;
			setIsPdfExporting(false);
			setPdfProgress(null);
		}
	};

	const handleCancelPdfExport = (): void => {
		pdfAbortRef.current?.abort();
	};

	const handleConfirmReset = (): void => {
		clearStagePlan();
		setActiveStageIndex(null);
		setConfirmReset(false);
	};

	const highlightPositions = useMemo((): [number, number][] => {
		if (activeStageIndex === null || !stagePlan || !enhancedTrailPoints?.length) return [];
		const stage = stagePlan.stages[activeStageIndex];
		const startIdx = findNearestPointIndex(enhancedTrailPoints, stage.startKm * 1000);
		const endIdx = findNearestPointIndex(enhancedTrailPoints, stage.endKm * 1000);
		return enhancedTrailPoints
			.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1)
			.map((p) => [p.lat, p.lng]);
	}, [activeStageIndex, stagePlan, enhancedTrailPoints]);

	const distanceUnitLabel = isImperial ? 'mi' : 'km';
	const valueUnitLabel = mode === 'stages' ? t('modeStages') : `${distanceUnitLabel}/day`;

	return (
		<>
			{highlightPositions.length > 0 && (
				<Polyline pathOptions={{ color: 'var(--cldt-blue)', opacity: 0.9, weight: 6 }} positions={highlightPositions} />
			)}
			<div
				aria-labelledby="stage-planner-title"
				aria-modal="true"
				className={`z-controls-popover absolute top-1/2 right-[calc(100%+0.5rem)] flex max-h-[calc(100svh-15rem)] w-80 -translate-y-1/2 flex-col gap-2 overflow-hidden ${MAP_CONTROL_POPOVER}`}
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
								max={toDisplay(endKm)}
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
								max={trailMetadata?.totalDistance ? toDisplay(trailMetadata.totalDistance) : undefined}
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
							value={mode === 'stages' ? stageCount : toDisplay(kmPerDayKm)}
							onChange={(e) => {
								const v = Number(e.target.value);
								if (!Number.isFinite(v) || v <= 0) return;
								if (mode === 'stages') setStageCount(Math.round(v));
								else setKmPerDayKm(fromDisplay(v));
							}}
						/>
					</label>

					<label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
						<Checkbox
							checked={balanceByEta}
							onCheckedChange={(checked) => {
								setBalanceByEta(checked);
							}}
						/>
						{t('balanceByEta')}
					</label>

					<Button variant="mapControlOutline" onClick={handleGenerate}>
						{t('generatePlan')}
					</Button>
				</div>

				{!stagePlan && <p className="mb-0 text-xs text-gray-500 dark:text-gray-400">{t('noStages')}</p>}

				{stagePlan && (
					<div className="flex min-h-0 flex-1 flex-col divide-y divide-gray-100 overflow-y-auto rounded border border-gray-100 dark:divide-[var(--border-color)] dark:border-[var(--border-color)]">
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
												↑{formatElevation(isNobo ? stats.lossM : stats.gainM, units)}
											</span>
											<span className="shrink-0 text-red-500 dark:text-red-400">
												↓{formatElevation(isNobo ? stats.gainM : stats.lossM, units)}
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
						{isPdfExporting ? (
							<div className="flex gap-2">
								<span className="flex flex-1 items-center justify-center text-xs text-gray-500 dark:text-gray-400">
									{pdfProgress
										? t('stripMapPdfProgress', { current: pdfProgress.current, total: pdfProgress.total })
										: t('stripMapPdf')}
								</span>
								<Button size="sm" variant="mapControlOutlineSecondary" onClick={handleCancelPdfExport}>
									{t('stripMapPdfCancel')}
								</Button>
							</div>
						) : (
							<Button variant="mapControlOutline" onClick={handleStripMapPdfExport}>
								{t('stripMapPdf')}
							</Button>
						)}
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
		</>
	);
}
