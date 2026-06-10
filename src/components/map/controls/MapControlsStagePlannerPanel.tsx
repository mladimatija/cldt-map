'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMap, Polyline } from 'react-leaflet';
import { IoHelpCircleOutline } from 'react-icons/io5';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { isKnownType, poiDisplayName, poiMatchesTagFilter, STAGE_POI_OFFTRAIL_KM, type Poi } from '@/lib/pois';
import { Button } from '@/components/ui/Button';
import { Radio } from '@/components/ui/Radio';
import { Checkbox } from '@/components/ui/Checkbox';
import { MapControlsTripBriefModal } from './MapControlsTripBriefModal';
import { cn, formatElevation, kmToMiles, milesToKm } from '@/lib/utils';
import { MAP_CONTROL_POPOVER, MAP_CONTROL_INPUT } from './map-controls-constants';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { usePopoverFocusTrap } from '@/hooks';
import {
	splitByDistance,
	splitByEta,
	computeStageStats,
	computeMinStagesForCap,
	DEFAULT_MAX_HOURS_PER_DAY,
} from '@/lib/stage-planner';
import { findNearestPointIndex, formatEta } from '@/lib/distance-utils';
import { useStageForecasts } from '@/hooks/useStageForecasts';
import { formatCompactTemp, weatherCodeToKey, weatherKeyToIcon } from '@/lib/weather';
import { buildGpxXml, buildGpxWaypointXml, downloadGpxFile, type GpxWaypoint } from '@/lib/gpx-export';
import { exportStripMapPdf, pointsToBounds } from '@/lib/export-utils';

const MAX_STAGES = 200;

export function MapControlsStagePlannerPanel(): React.ReactElement {
	const t = useTranslations('stagePlanner');
	const tPois = useTranslations('pois');
	const tWeather = useTranslations('weather');
	const locale = useLocale();

	const stagePlan = useMapStore((s: MapStoreState) => s.stagePlan);
	const setStagePlan = useMapStore((s: MapStoreState) => s.setStagePlan);
	const clearStagePlan = useMapStore((s: MapStoreState) => s.clearStagePlan);
	const walkingPaceKmh = useMapStore((s: MapStoreState) => s.walkingPaceKmh);
	const gradeAdjustedEta = useMapStore((s: MapStoreState) => s.gradeAdjustedEta);
	const units = useMapStore((s: MapStoreState) => s.units);
	const poisFile = useMapStore((s: MapStoreState) => s.poisFile);
	const poisLayerEnabled = useMapStore((s: MapStoreState) => s.poisLayerEnabled);
	const enabledPoiTypes = useMapStore((s: MapStoreState) => s.enabledPoiTypes);
	const enabledPoiTags = useMapStore((s: MapStoreState) => s.enabledPoiTags);
	const requestOpenPoi = useMapStore((s: MapStoreState) => s.requestOpenPoi);

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
	const [maxHoursPerDay, setMaxHoursPerDay] = useState(DEFAULT_MAX_HOURS_PER_DAY);
	const [autoBumpNotice, setAutoBumpNotice] = useState<{ requested: number; actual: number } | null>(null);
	const [activeStageIndex, setActiveStageIndex] = useState<number | null>(null);
	const [confirmReset, setConfirmReset] = useState(false);
	/** Optional trip start date (yyyy-mm-dd); enables per-stage forecasts. */
	const [tripStartDate, setTripStartDate] = useState<string>(() => stagePlan?.startDate ?? '');

	const handleTripStartDateChange = (value: string): void => {
		setTripStartDate(value);
		// Keep an existing plan in sync so forecasts (and the persisted plan)
		// update without regenerating stages.
		if (stagePlan) {
			setStagePlan({ ...stagePlan, startDate: value || undefined });
		}
	};
	const [isPdfExporting, setIsPdfExporting] = useState(false);
	const [isTripBriefOpen, setIsTripBriefOpen] = useState(false);
	const [pdfProgress, setPdfProgress] = useState<{ current: number; total: number } | null>(null);
	const pdfAbortRef = useRef<AbortController | null>(null);

	const toDisplay = (km: number): number => (isImperial ? Math.round(kmToMiles(km) * 10) / 10 : km);
	const fromDisplay = (display: number): number => (isImperial ? milesToKm(display) : display);

	// One batched Open-Meteo call per plan; null per stage outside the horizon.
	const stageForecasts = useStageForecasts(stagePlan, enhancedTrailPoints);

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
		const requestedCount =
			mode === 'stages'
				? safeStageCount
				: Math.min(MAX_STAGES, Math.max(1, Math.ceil((endKm - startKm) / safeKmPerDay)));
		const minCount = computeMinStagesForCap(
			enhancedTrailPoints,
			startKm,
			endKm,
			walkingPaceKmh,
			gradeAdjustedEta,
			maxHoursPerDay,
		);
		const finalCount = Math.min(MAX_STAGES, Math.max(requestedCount, minCount));
		setAutoBumpNotice(finalCount > requestedCount ? { requested: requestedCount, actual: finalCount } : null);
		const plan = balanceByEta
			? splitByEta(enhancedTrailPoints, startKm, endKm, walkingPaceKmh, gradeAdjustedEta, finalCount)
			: splitByDistance(startKm, endKm, (endKm - startKm) / finalCount);
		setStagePlan({ ...plan, startDate: tripStartDate || undefined });
		setActiveStageIndex(0);
		setConfirmReset(false);
	};

	const handleStageClick = (index: number): void => {
		if (index === activeStageIndex) {
			setActiveStageIndex(null);
			return;
		}
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
		if (isNobo) pts = [...pts].reverse();
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

	/** POIs that the renderer would also draw - same enabled-types and master
	 *  toggle filter so the planner view never lists POIs the user has hidden. */
	const visiblePois = useMemo((): Poi[] => {
		if (!poisFile?.pois?.length || !poisLayerEnabled) return [];
		return poisFile.pois.filter(
			(p) =>
				isKnownType(p.type) &&
				enabledPoiTypes.has(p.type) &&
				poiMatchesTagFilter(p, enabledPoiTags) &&
				p.distanceFromTrailKm <= STAGE_POI_OFFTRAIL_KM,
		);
	}, [poisFile, poisLayerEnabled, enabledPoiTypes, enabledPoiTags]);

	/** Per-stage POI buckets keyed by stage index. SOBO km of each POI is
	 *  compared against the stage's [startKm, endKm] window (also SOBO). Sorted
	 *  by trailKm within the stage so the list reads in walking order for SOBO
	 *  hikers; NOBO display flips it below. */
	const poisByStage = useMemo((): Poi[][] => {
		if (!stagePlan || visiblePois.length === 0) return [];
		return stagePlan.stages.map((stage) => {
			const lo = Math.min(stage.startKm, stage.endKm);
			const hi = Math.max(stage.startKm, stage.endKm);
			return visiblePois.filter((p) => p.trailKm >= lo && p.trailKm <= hi).sort((a, b) => a.trailKm - b.trailKm);
		});
	}, [stagePlan, visiblePois]);

	const activeStagePois = useMemo((): Poi[] => {
		if (activeStageIndex === null || !poisByStage[activeStageIndex]) return [];
		const pois = poisByStage[activeStageIndex];
		return isNobo ? [...pois].reverse() : pois;
	}, [activeStageIndex, poisByStage, isNobo]);

	/** Flat, deduplicated waypoint list across every stage in the current plan.
	 *  Dedup by id since a POI sitting at a stage boundary can legitimately
	 *  appear in two consecutive buckets. Pre-computed via useMemo so the
	 *  export-button disabled flag and the click handler agree on the count
	 *  without re-walking the buckets twice. */
	const allStagesWaypoints = useMemo((): GpxWaypoint[] => {
		if (!stagePlan || poisByStage.length === 0) return [];
		const seen = new Set<string>();
		const out: GpxWaypoint[] = [];
		for (const pois of poisByStage) {
			for (const poi of pois) {
				if (seen.has(poi.id)) continue;
				seen.add(poi.id);
				const name = poiDisplayName(poi, locale);
				const typeLabel = tPois(`type.${poi.type}`, { default: poi.type });
				out.push({
					lat: poi.lat,
					lng: poi.lng,
					name,
					type: typeLabel,
					elevation: typeof poi.elevationM === 'number' ? poi.elevationM : undefined,
					description: poi.note_en || poi.note_hr || undefined,
					url: poi.url || undefined,
				});
			}
		}
		return out;
	}, [stagePlan, poisByStage, locale, tPois]);

	const handleAllStagesPoiExport = (): void => {
		if (allStagesWaypoints.length === 0) return;
		const xml = buildGpxWaypointXml(allStagesWaypoints, t('title'));
		downloadGpxFile(xml, 'cldt-stages-pois.gpx');
	};

	const handlePoiClick = (poi: Poi): void => {
		requestOpenPoi(poi.id);
	};

	return (
		<>
			{highlightPositions.length > 0 && (
				<Polyline pathOptions={{ color: 'var(--cldt-blue)', opacity: 0.9, weight: 6 }} positions={highlightPositions} />
			)}
			<div
				aria-labelledby="stage-planner-title"
				aria-modal="true"
				className={`z-controls-popover fixed top-2 right-16 flex h-[calc(100dvh-4rem)] w-80 flex-col gap-2 overflow-hidden ${MAP_CONTROL_POPOVER}`}
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
							{t('startKm', { unit: distanceUnitLabel })}
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
							{t('endKm', { unit: distanceUnitLabel })}
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

					<div className="flex gap-2">
						<label className="flex flex-1 flex-col gap-0.5 text-xs text-gray-600 dark:text-gray-400">
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
						<label className="flex flex-1 flex-col gap-0.5 text-xs text-gray-600 dark:text-gray-400">
							{t('maxHoursPerDay')}
							<input
								className={MAP_CONTROL_INPUT}
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
						</label>
					</div>

					<label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
						<Checkbox
							checked={balanceByEta}
							onCheckedChange={(checked) => {
								setBalanceByEta(checked);
							}}
						/>
						{t('balanceByEta')}
						<span className="inline-flex" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
							<SmartTooltip content={t('balanceByEtaHelp')} position="top">
								<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
							</SmartTooltip>
						</span>
					</label>

					<label className="flex flex-col gap-0.5 text-xs text-gray-600 dark:text-gray-400">
						{t('tripStartDate')}
						<input
							className={cn(MAP_CONTROL_INPUT, 'w-full')}
							type="date"
							value={tripStartDate}
							onChange={(e) => handleTripStartDateChange(e.target.value)}
						/>
					</label>

					<Button variant="mapControlOutline" onClick={handleGenerate}>
						{t('generatePlan')}
					</Button>

					{autoBumpNotice && (
						<p className="text-cldt-blue dark:text-cldt-blue m-0 text-[11px]">
							{t('autoBumpNotice', {
								actual: autoBumpNotice.actual,
								requested: autoBumpNotice.requested,
								hours: maxHoursPerDay,
								pace: walkingPaceKmh,
							})}
						</p>
					)}
				</div>

				{!stagePlan && <p className="mb-0 text-xs text-gray-500 dark:text-gray-400">{t('noStages')}</p>}

				{stagePlan && (
					<div className="flex min-h-0 flex-1 flex-col divide-y divide-gray-100 overflow-y-auto rounded border border-gray-100 dark:divide-[var(--border-color)] dark:border-[var(--border-color)]">
						{stagePlan.stages.map((stage, i) => {
							const stats = stageStats[i];
							const poiCount = poisByStage[i]?.length ?? 0;
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
										{toDisplay(stage.startKm).toFixed(0)}-{toDisplay(stage.endKm).toFixed(0)} {distanceUnitLabel}
									</span>
									{stats && (
										<>
											<span className="text-cldt-green shrink-0">
												↑{formatElevation(isNobo ? stats.lossM : stats.gainM, units)}
											</span>
											<span className="text-cldt-red shrink-0">
												↓{formatElevation(isNobo ? stats.gainM : stats.lossM, units)}
											</span>
											<span className="shrink-0 text-gray-500 tabular-nums dark:text-gray-400">
												{formatEta(stats.etaSec)}
											</span>
										</>
									)}
									{poiCount > 0 && (
										<span
											aria-label={t('stagePoiCount', { count: poiCount })}
											className="text-cldt-blue bg-cldt-blue/10 ml-1 shrink-0 rounded-full px-1.5 py-0 text-[10px] font-medium tabular-nums"
											title={t('stagePoiCount', { count: poiCount })}
										>
											{poiCount}
										</span>
									)}
									{stageForecasts[i] && (
										<span
											aria-label={t('forecastTitle', {
												condition: tWeather(weatherCodeToKey(stageForecasts[i].weatherCode)),
												max: formatCompactTemp(stageForecasts[i].tMaxC, units),
												min: formatCompactTemp(stageForecasts[i].tMinC, units),
												precip: stageForecasts[i].precipProbPct,
											})}
											className="ml-1 shrink-0 text-gray-600 tabular-nums dark:text-gray-300"
											title={t('forecastTitle', {
												condition: tWeather(weatherCodeToKey(stageForecasts[i].weatherCode)),
												max: formatCompactTemp(stageForecasts[i].tMaxC, units),
												min: formatCompactTemp(stageForecasts[i].tMinC, units),
												precip: stageForecasts[i].precipProbPct,
											})}
										>
											<span aria-hidden>{weatherKeyToIcon(weatherCodeToKey(stageForecasts[i].weatherCode))}</span>{' '}
											{formatCompactTemp(stageForecasts[i].tMaxC, units)}
										</span>
									)}
								</button>
							);
						})}
					</div>
				)}

				{stagePlan && activeStageIndex !== null && activeStagePois.length > 0 && (
					<div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded border border-gray-100 px-2 py-1 dark:border-[var(--border-color)]">
						<p className="text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
							{t('stagePoisHeading', { index: activeStageIndex + 1 })}
						</p>
						{activeStagePois.map((poi) => {
							const name = poiDisplayName(poi, locale);
							const typeLabel = tPois(`type.${poi.type}`, { default: poi.type });
							return (
								<button
									className="hover:bg-cldt-blue/10 focus-visible:bg-cldt-blue/10 dark:hover:bg-cldt-blue/20 focus-visible:ring-cldt-green flex w-full items-baseline gap-1 rounded px-1 py-0.5 text-left text-xs focus-visible:ring-2 focus-visible:outline-none"
									key={poi.id}
									type="button"
									onClick={() => handlePoiClick(poi)}
								>
									<span className="truncate font-medium text-gray-800 dark:text-[var(--text-primary)]">{name}</span>
									<span className="ml-auto shrink-0 text-[10px] text-gray-500 dark:text-gray-400">{typeLabel}</span>
								</button>
							);
						})}
					</div>
				)}

				{stagePlan && !confirmReset && (
					<div className="flex flex-col gap-2">
						<Button
							disabled={activeStageIndex === null}
							title={t('gpxExportTooltip')}
							variant="mapControlOutline"
							onClick={handleGpxExport}
						>
							{t('gpxExport')}
						</Button>
						<Button
							disabled={allStagesWaypoints.length === 0}
							title={t('gpxPoisExportTooltip')}
							variant="mapControlOutline"
							onClick={handleAllStagesPoiExport}
						>
							{t('gpxPoisExport')}
						</Button>
						{isPdfExporting ? (
							<div className="flex gap-2">
								<span className="flex flex-1 items-center justify-center text-xs text-gray-500 dark:text-gray-400">
									{pdfProgress
										? t('stripMapPdfProgress', { current: pdfProgress.current, total: pdfProgress.total })
										: t('stripMapPdf')}
								</span>
								<Button
									size="sm"
									title={t('stripMapPdfCancelTooltip')}
									variant="mapControlOutlineSecondary"
									onClick={handleCancelPdfExport}
								>
									{t('stripMapPdfCancel')}
								</Button>
							</div>
						) : (
							<Button title={t('stripMapPdfTooltip')} variant="mapControlOutline" onClick={handleStripMapPdfExport}>
								{t('stripMapPdf')}
							</Button>
						)}
						<Button
							disabled={!stagePlan || stagePlan.stages.length === 0}
							title={t('tripBriefOpenTooltip')}
							variant="mapControlOutline"
							onClick={() => setIsTripBriefOpen(true)}
						>
							{t('tripBriefOpen')}
						</Button>
						<Button
							title={t('resetTooltip')}
							variant="mapControlOutlineSecondary"
							onClick={() => setConfirmReset(true)}
						>
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
			<MapControlsTripBriefModal open={isTripBriefOpen} onClose={() => setIsTripBriefOpen(false)} />
		</>
	);
}
