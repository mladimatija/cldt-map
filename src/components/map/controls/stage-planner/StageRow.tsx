'use client';

import React from 'react';
import { IoBedOutline, IoTrashOutline } from 'react-icons/io5';
import { poiDisplayName } from '@/lib/pois';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { MapControlIconButton } from '../MapControlIconButton';
import { cn } from '@/lib/cn';
import { formatDistance, formatElevation } from '@/lib/format';
import { MAP_CONTROL_LINK_BUTTON } from '../map-controls-constants';
import { CARRY_WARN_L, formatPackWeightRange, formatVolume, formatWeight } from '@/lib/pack-weight';
import { formatEta } from '@/lib/distance-utils';
import { formatCompactTemp, weatherCodeToKey, weatherKeyToIcon } from '@/lib/weather';
import { WATER_GAP_DANGER_KM, WATER_GAP_WARN_KM } from '@/lib/water-intelligence';
import { buildGpxWaypointXml, downloadGpxFile, type GpxWaypoint } from '@/lib/gpx-export';
import { SAC_SCALE_ORDER, type SacScale } from '@/lib/trail-osm-tags';
import { hasDemandingSacTerrain } from '@/lib/stage-sac-stats';
import { SAC_BUCKET_SHORT_LABELS, SAC_COLORS } from '@/components/map/trail-route-constants';
import { stageCalendarDate } from '@/lib/stage-ical-export';
import { dayOffsetForRestDayAfter, restDayCountAfter } from '@/lib/stage-rest-days';
import { formatShortWeekdayDate } from '@/lib/date-format';
import type { StagePlannerData } from './useStagePlannerData';

const COLLAPSED_STAGE_CHIP_LIMIT = 3;

interface StageRowProps {
	i: number;
	isActive: boolean;
	stats: StagePlannerData['stageStats'][number] | undefined;
	range: StagePlannerData['stageRanges'][number];
	/** In the order the hiker passes them. */
	stagePois: StagePlannerData['stagePoisInTravelOrder'][number];
	stageCadence: NonNullable<StagePlannerData['planResupplyCadence']>['stages'][number] | undefined;
	stageSelectedPoiIds: ReadonlySet<string>;
	dateLabel: string | undefined;
	stageSac: StagePlannerData['stageSacByStage'][number] | undefined;
	accommodation: StagePlannerData['accommodationByStage'][number] | undefined;
	waterGapKm: number | undefined;
	packScenario: StagePlannerData['packScenariosByStage'][number] | undefined;
	forecast: StagePlannerData['stageForecasts'][number] | undefined;
	/** Set for the open stage only. */
	activeStageElevationThumb: string | null;
	activeStageToughestStretches: StagePlannerData['activeStageToughestStretches'];
	restDays: number[] | undefined;
	startDate: string | undefined;
	shared: StagePlannerData['stageRowShared'];
}

/**
 * One stage: the summary button with its chips, the expanded details, and any
 * rest days after it. Memoized with its own stage values as props, so opening a
 * stage or ticking a stage POI re-renders the rows it changes, not every row.
 */
export const StageRow = React.memo(function StageRow({
	i,
	isActive,
	stats,
	range,
	stagePois,
	stageCadence,
	stageSelectedPoiIds,
	dateLabel,
	stageSac,
	accommodation,
	waterGapKm,
	packScenario,
	forecast,
	activeStageElevationThumb,
	activeStageToughestStretches,
	restDays,
	startDate,
	shared,
}: StageRowProps): React.ReactElement {
	const {
		addRestDayAfter,
		distancePrecision,
		distanceUnitLabel,
		handlePoiClick,
		handleStageClick,
		locale,
		removeRestDayAfter,
		resupplyStatusLabel,
		setSelectedStagePoiIdsByStage,
		stageResupplyDetailLines,
		t,
		toDisplay,
		tPois,
		travelRange,
		tWeather,
		units,
	} = shared;

	const poiCount = stagePois.length;
	const resupplyStatus = stageCadence?.status ?? null;
	return (
		<>
			<div className={cn('border-l-4', isActive ? 'border-l-cldt-blue bg-cldt-light-blue/40' : 'border-l-transparent')}>
				<button
					aria-expanded={isActive}
					className={cn(
						'focus-visible:ring-cldt-green flex w-full flex-col gap-0.5 px-2 py-1.5 text-left text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
						isActive ? 'text-gray-900 dark:text-white' : 'hover:bg-gray-50 dark:hover:bg-[var(--bg-hover)]',
					)}
					type="button"
					onClick={() => handleStageClick(i, isActive)}
				>
					<span className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
						<span className="min-w-4 font-medium">{i + 1}</span>
						<span className="whitespace-nowrap text-gray-500 dark:text-[var(--text-secondary)]">
							{toDisplay(range.from).toFixed(0)}-{toDisplay(range.to).toFixed(0)} {distanceUnitLabel}
						</span>
						{dateLabel && (
							<span className="shrink-0 whitespace-nowrap text-gray-400 dark:text-[var(--text-secondary)]">
								{dateLabel}
							</span>
						)}
						{stats && (
							<>
								<span className="text-cldt-green shrink-0">↑{formatElevation(stats.gainM, units)}</span>
								<span className="text-cldt-red shrink-0">↓{formatElevation(stats.lossM, units)}</span>
								<span className="shrink-0 text-gray-500 tabular-nums dark:text-[var(--text-secondary)]">
									{formatEta(stats.etaSec)}
								</span>
							</>
						)}
					</span>
					{(() => {
						const chips: React.ReactElement[] = [];
						const sacBreakdown = stageSac;
						if (hasDemandingSacTerrain(sacBreakdown) && sacBreakdown?.hardestClass) {
							const hardestClass = sacBreakdown.hardestClass;
							const shortLabel = SAC_BUCKET_SHORT_LABELS[hardestClass];
							const kmDisplay = toDisplay(sacBreakdown.hardestKm);
							const kmCompact = kmDisplay < 10 ? kmDisplay.toFixed(1) : kmDisplay.toFixed(0);
							// One distance string for both the visible chip and its aria-label so
							// the spoken and shown distance can never round differently. Formats via
							// toDisplay like the sibling water chip rather than formatDistance.
							const hardestDistance = `${kmCompact} ${distanceUnitLabel}`;
							const terrainAria = t('stageTerrainChip', {
								class: shortLabel,
								distance: hardestDistance,
							});
							chips.push(
								<span
									aria-label={terrainAria}
									className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-gray-500/10 px-1.5 py-0 text-[0.625rem] font-medium text-gray-600 tabular-nums dark:text-[var(--text-primary)]"
									key="terrain"
									title={terrainAria}
								>
									<span aria-hidden>⛰️</span>
									{/* SAC class colour swatch keeps the pill legible in dark mode, like the expanded SAC-mix rows. */}
									<span
										aria-hidden
										className="size-2 shrink-0 rounded-full"
										style={{ backgroundColor: SAC_COLORS[hardestClass] }}
									/>
									{shortLabel} {hardestDistance}
								</span>,
							);
						}
						if (poiCount > 0) {
							chips.push(
								<span
									aria-label={t('stagePoiCount', { count: poiCount })}
									className="text-cldt-blue bg-cldt-blue/10 shrink-0 rounded-full px-1.5 py-0 text-[0.625rem] font-medium tabular-nums"
									key="poi"
									title={t('stagePoiCount', { count: poiCount })}
								>
									{poiCount}
								</span>,
							);
						}
						const sleepAcc = accommodation;
						if (sleepAcc) {
							const accName = poiDisplayName(sleepAcc.poi, locale);
							const accAria = t('stageSleepAria', { name: accName });
							chips.push(
								<span
									aria-label={accAria}
									className="inline-flex max-w-[7rem] shrink-0 items-center gap-0.5 rounded-full bg-indigo-500/10 px-1.5 py-0 text-[0.625rem] font-medium text-indigo-700 dark:text-indigo-300"
									key="sleep"
									title={accAria}
								>
									<span aria-hidden>🛏️</span>
									<span className="truncate">{accName}</span>
								</span>,
							);
						}
						if (waterGapKm !== undefined && waterGapKm >= WATER_GAP_WARN_KM) {
							chips.push(
								<span
									aria-label={t('stageWaterGap', {
										distance: `${toDisplay(waterGapKm).toFixed(0)} ${distanceUnitLabel}`,
									})}
									className={cn(
										'shrink-0 rounded-full px-1.5 py-0 text-[0.625rem] font-medium tabular-nums',
										waterGapKm >= WATER_GAP_DANGER_KM
											? 'bg-cldt-red/10 text-cldt-red'
											: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
									)}
									key="water"
									title={t('stageWaterGap', {
										distance: `${toDisplay(waterGapKm).toFixed(0)} ${distanceUnitLabel}`,
									})}
								>
									<span aria-hidden>💧</span>
									{toDisplay(waterGapKm).toFixed(0)}
								</span>,
							);
						}
						if (packScenario !== undefined) {
							chips.push(
								<span
									aria-label={
										packScenario.carryLiters > 0
											? t('stagePackTooltipLoaded', {
													base: formatWeight(packScenario.baseKg, units),
													loaded: formatWeight(packScenario.loadedKg, units),
													volume: formatVolume(packScenario.carryLiters, units),
												})
											: t('stagePackTooltipBase', {
													base: formatWeight(packScenario.baseKg, units),
												})
									}
									className={cn(
										'shrink-0 rounded-full px-1.5 py-0 text-[0.625rem] font-medium tabular-nums',
										packScenario.carryLiters >= CARRY_WARN_L
											? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
											: 'bg-gray-500/10 text-gray-600 dark:text-[var(--text-primary)]',
									)}
									key="pack"
									title={
										packScenario.carryLiters > 0
											? t('stagePackTooltipLoaded', {
													base: formatWeight(packScenario.baseKg, units),
													loaded: formatWeight(packScenario.loadedKg, units),
													volume: formatVolume(packScenario.carryLiters, units),
												})
											: t('stagePackTooltipBase', {
													base: formatWeight(packScenario.baseKg, units),
												})
									}
								>
									<span aria-hidden>🎒</span>
									{formatPackWeightRange(packScenario.baseKg, packScenario.loadedKg, units)}
								</span>,
							);
						}
						if (resupplyStatus !== null && resupplyStatusLabel(resupplyStatus)) {
							chips.push(
								<span
									aria-label={resupplyStatusLabel(resupplyStatus)}
									className={cn(
										'shrink-0 rounded-full px-1.5 py-0 text-[0.625rem] font-medium',
										resupplyStatus === 'yes'
											? 'bg-gray-500/10 text-gray-600 dark:text-[var(--text-primary)]'
											: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
									)}
									key="resupply"
									title={resupplyStatusLabel(resupplyStatus)}
								>
									<span aria-hidden>🛒</span>
									{resupplyStatus === 'partial' && <span aria-hidden>~</span>}
									{resupplyStatus === 'no' && <span aria-hidden>✕</span>}
								</span>,
							);
						}
						if (forecast) {
							chips.push(
								<span
									aria-label={t('forecastTitle', {
										condition: tWeather(weatherCodeToKey(forecast.weatherCode)),
										max: formatCompactTemp(forecast.tMaxC, units),
										min: formatCompactTemp(forecast.tMinC, units),
										precip: forecast.precipProbPct,
									})}
									className="shrink-0 text-gray-600 tabular-nums dark:text-[var(--text-primary)]"
									key="forecast"
									title={t('forecastTitle', {
										condition: tWeather(weatherCodeToKey(forecast.weatherCode)),
										max: formatCompactTemp(forecast.tMaxC, units),
										min: formatCompactTemp(forecast.tMinC, units),
										precip: forecast.precipProbPct,
									})}
								>
									<span aria-hidden>{weatherKeyToIcon(weatherCodeToKey(forecast.weatherCode))}</span>{' '}
									{formatCompactTemp(forecast.tMaxC, units)}
								</span>,
							);
						}
						if (chips.length === 0) return null;
						const visibleChips = isActive ? chips : chips.slice(0, COLLAPSED_STAGE_CHIP_LIMIT);
						const overflowCount = isActive ? 0 : Math.max(0, chips.length - COLLAPSED_STAGE_CHIP_LIMIT);
						return (
							<span className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-5">
								{visibleChips}
								{overflowCount > 0 && (
									<span
										aria-label={t('stageChipOverflow', { count: overflowCount })}
										className="shrink-0 rounded-full bg-gray-500/10 px-1.5 py-0 text-[0.625rem] font-medium text-gray-600 tabular-nums dark:text-[var(--text-primary)]"
										title={t('stageChipOverflow', { count: overflowCount })}
									>
										{t('stageChipOverflow', { count: overflowCount })}
									</span>
								)}
							</span>
						);
					})()}
				</button>
				{isActive && (
					<div className="flex flex-col gap-1 border-t border-gray-100 px-2 py-1.5 pl-3 dark:border-[var(--border-color)]">
						{activeStageElevationThumb && stats && (
							// The renderer emits a white, print-sized PNG data URL; scale it
							// down responsively and sit it on a bordered light card so it reads
							// in dark mode too. Only the expanded stage draws a canvas. A raw
							// <img> is the right fit for a client-generated data URL.
							// eslint-disable-next-line @next/next/no-img-element
							<img
								alt={t('stageElevationProfileAlt', {
									index: i + 1,
									gain: formatElevation(stats.gainM, units),
									loss: formatElevation(stats.lossM, units),
								})}
								className="h-auto w-full rounded border border-gray-200 bg-white dark:border-[var(--border-color)]"
								src={activeStageElevationThumb}
							/>
						)}
						{(() => {
							const sacBreakdown = stageSac;
							const stretches = activeStageToughestStretches;
							const sacRows =
								sacBreakdown && sacBreakdown.taggedKm > 0
									? (Object.keys(sacBreakdown.kmByClass) as SacScale[])
											.filter((c) => (sacBreakdown.kmByClass[c] ?? 0) > 0)
											.sort((a, b) => SAC_SCALE_ORDER.indexOf(a) - SAC_SCALE_ORDER.indexOf(b))
									: [];
							if (sacRows.length === 0 && stretches.length === 0) return null;
							return (
								<div className="flex flex-col gap-0.5">
									{sacRows.length > 0 && (
										<>
											<p className="m-0 text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
												{t('stageTerrainHeading')}
											</p>
											<span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
												{sacRows.map((c) => (
													<span
														className="inline-flex items-center gap-1 text-[0.625rem] text-gray-600 tabular-nums dark:text-[var(--text-secondary)]"
														key={c}
													>
														<span
															aria-hidden
															className="size-2 shrink-0 rounded-full"
															style={{ backgroundColor: SAC_COLORS[c] }}
														/>
														{SAC_BUCKET_SHORT_LABELS[c]}{' '}
														{formatDistance(sacBreakdown?.kmByClass[c] ?? 0, units, distancePrecision)}
													</span>
												))}
											</span>
										</>
									)}
									{stretches.length > 0 && (
										<>
											<p className="m-0 mt-0.5 text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
												{t('stageToughestHeading')}
											</p>
											{stretches.map((s) => {
												const grade = Math.round(s.avgGradePct);
												const reason =
													s.kind === 'climb'
														? t('stageTerrainSteepClimb', { grade })
														: t('stageTerrainSteepDescent', { grade });
												const range = travelRange({ startKm: s.fromKm, endKm: s.toKm });
												const bounds = `${toDisplay(range.from).toFixed(1)}-${toDisplay(range.to).toFixed(1)} ${distanceUnitLabel}`;
												const sacNote = s.sacClass
													? ` · ${t('stageTerrainSacNote', { class: SAC_BUCKET_SHORT_LABELS[s.sacClass] })}`
													: '';
												return (
													<p
														className="m-0 text-[0.625rem] leading-snug text-gray-500 dark:text-[var(--text-secondary)]"
														key={`${s.fromKm}-${s.toKm}-${s.kind}`}
													>
														<span aria-hidden>{s.kind === 'climb' ? '↗' : '↘'}</span>{' '}
														<span className="tabular-nums">{bounds}</span> · {reason}
														{sacNote}
													</p>
												);
											})}
											<p className="m-0 text-[0.5625rem] leading-snug text-gray-400 italic dark:text-[var(--text-secondary)]">
												{t('stageTerrainCoverageNote')}
											</p>
										</>
									)}
								</div>
							);
						})()}
						{(() => {
							const acc = accommodation;
							if (!acc) return null;
							const accName = poiDisplayName(acc.poi, locale);
							const typeLabel = tPois(`type.${acc.poi.type}`, { default: acc.poi.type });
							const absKm = Math.abs(acc.alongKm);
							const line =
								absKm < 0.1
									? t('stageSleepAt', { name: accName, type: typeLabel })
									: t('stageSleepAway', {
											name: accName,
											type: typeLabel,
											distance: `${toDisplay(absKm).toFixed(1)} ${distanceUnitLabel}`,
										});
							const offTrail =
								acc.offTrailKm >= 0.2
									? ` · ${t('stageSleepOffTrail', { distance: `${toDisplay(acc.offTrailKm).toFixed(1)} ${distanceUnitLabel}` })}`
									: '';
							return (
								<p className="m-0 text-[0.625rem] leading-snug text-gray-500 dark:text-[var(--text-secondary)]">
									<span aria-hidden>🛏️</span> {line}
									{offTrail}
								</p>
							);
						})()}
						{waterGapKm !== undefined && (
							<p
								className={cn(
									'm-0 text-[0.625rem]',
									waterGapKm >= WATER_GAP_DANGER_KM
										? 'text-cldt-red'
										: waterGapKm >= WATER_GAP_WARN_KM
											? 'text-amber-700 dark:text-amber-400'
											: 'text-gray-500 dark:text-[var(--text-secondary)]',
								)}
							>
								<span aria-hidden>💧</span>{' '}
								{t('stageWaterGap', {
									distance: `${toDisplay(waterGapKm).toFixed(0)} ${distanceUnitLabel}`,
								})}
							</p>
						)}
						{packScenario !== undefined && (
							<div className="m-0 flex flex-col gap-0.5 text-gray-500 dark:text-[var(--text-secondary)]">
								<p className="m-0 text-[0.625rem] leading-snug">
									<span aria-hidden>🎒</span>{' '}
									{t('stagePackBase', {
										weight: formatWeight(packScenario.baseKg, units),
									})}
								</p>
								{packScenario.carryLiters > 0 ? (
									<p className="m-0 text-[0.625rem] leading-snug">
										{t('stagePackLoaded', {
											weight: formatWeight(packScenario.loadedKg, units),
											volume: formatVolume(packScenario.carryLiters, units),
										})}
									</p>
								) : (
									<p className="m-0 text-[0.625rem] leading-snug">{t('stagePackLoadedSame')}</p>
								)}
							</div>
						)}
						{stageResupplyDetailLines(stageCadence).map((line) => (
							<p className="m-0 text-[0.625rem] leading-snug text-amber-700 dark:text-amber-400" key={line}>
								<span aria-hidden>🛒</span> {line}
							</p>
						))}
						{stagePois.length > 0 && (
							<>
								<p className="m-0 text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
									{t('stagePoisHeading', { index: i + 1 })}
								</p>
								{stagePois.map((poi) => {
									const name = poiDisplayName(poi, locale);
									const typeLabel = tPois(`type.${poi.type}`, { default: poi.type });
									const isSelected = stageSelectedPoiIds.has(poi.id);
									return (
										<div
											className={cn(
												'group hover:bg-cldt-blue/10 dark:hover:bg-cldt-blue/20 flex w-full items-center gap-1.5 rounded px-0.5 py-0',
												isSelected && 'bg-cldt-blue/5 dark:bg-cldt-blue/15',
											)}
											key={poi.id}
										>
											<Checkbox
												aria-label={isSelected ? tPois('exportDeselect', { name }) : tPois('exportSelect', { name })}
												checked={isSelected}
												className="shrink-0"
												title={isSelected ? tPois('exportDeselect', { name }) : tPois('exportSelect', { name })}
												onCheckedChange={() => {
													setSelectedStagePoiIdsByStage((prev) => {
														const next = new Map(prev);
														const stageSet = new Set(next.get(i) ?? []);
														if (stageSet.has(poi.id)) stageSet.delete(poi.id);
														else stageSet.add(poi.id);
														if (stageSet.size === 0) next.delete(i);
														else next.set(i, stageSet);
														return next;
													});
												}}
											/>
											<button
												className="focus-visible:ring-cldt-green flex min-h-0 min-w-0 flex-1 items-baseline gap-1 rounded py-0 text-left text-xs leading-tight focus-visible:ring-2 focus-visible:outline-none"
												type="button"
												onClick={() => handlePoiClick(poi)}
											>
												<span className="truncate font-medium text-gray-800 dark:text-[var(--text-primary)]">
													{name}
												</span>
												<span className="ml-auto shrink-0 text-[0.625rem] text-gray-500 dark:text-[var(--text-secondary)]">
													{typeLabel}
												</span>
											</button>
										</div>
									);
								})}
								<div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-1 dark:border-[var(--border-color)]">
									<span className="text-[0.625rem] text-gray-500 dark:text-[var(--text-secondary)]">
										{tPois('exportSelectionCount', { count: stageSelectedPoiIds.size })}
									</span>
									<Button
										disabled={stageSelectedPoiIds.size === 0}
										size="sm"
										title={t('gpxStagePoisExportTooltip', { index: i + 1 })}
										variant="mapControlOutline"
										onClick={() => {
											if (stageSelectedPoiIds.size === 0) return;
											const picked = stagePois.filter((p) => stageSelectedPoiIds.has(p.id));
											if (picked.length === 0) return;
											const waypoints: GpxWaypoint[] = picked.map((p) => {
												const name = poiDisplayName(p, locale);
												const typeLabel = tPois(`type.${p.type}`, { default: p.type });
												return {
													lat: p.lat,
													lng: p.lng,
													name,
													type: typeLabel,
													elevation: typeof p.elevationM === 'number' ? p.elevationM : undefined,
													description: p.note_en || p.note_hr || undefined,
													url: p.url || undefined,
												};
											});
											const xml = buildGpxWaypointXml(waypoints, t('stagePoisHeading', { index: i + 1 }));
											downloadGpxFile(xml, `cldt-stage-${i + 1}-pois.gpx`);
										}}
									>
										{t('gpxStagePoisExport')}
									</Button>
								</div>
							</>
						)}
						<button
							className={cn(MAP_CONTROL_LINK_BUTTON, 'flex items-center gap-1 self-start')}
							title={t('addRestDay')}
							type="button"
							onClick={() => addRestDayAfter(i)}
						>
							<IoBedOutline aria-hidden className="h-3.5 w-3.5 shrink-0" />
							{t('addRestDay')}
						</button>
					</div>
				)}
			</div>
			{Array.from({ length: restDayCountAfter(i, restDays) }, (_, occ) => {
				// The day offset is unique across the whole plan (each rest day
				// is a distinct calendar day), so it is a stable React key.
				const restOffset = dayOffsetForRestDayAfter(i, occ, restDays);
				const restDate = startDate ? formatShortWeekdayDate(stageCalendarDate(startDate, restOffset), locale) : null;
				return (
					<div
						className="flex items-center gap-1.5 border-l-4 border-l-transparent bg-gray-50/70 px-2 py-1.5 text-xs text-gray-500 dark:bg-[var(--bg-hover)]/40 dark:text-[var(--text-secondary)]"
						key={`rest-${restOffset}`}
					>
						<IoBedOutline aria-hidden className="h-3.5 w-3.5 shrink-0" />
						<span className="font-medium">{t('restDayLabel')}</span>
						{restDate && (
							<span className="whitespace-nowrap text-gray-400 dark:text-[var(--text-secondary)]">{restDate}</span>
						)}
						<MapControlIconButton
							aria-label={t('removeRestDay')}
							className="ml-auto"
							title={t('removeRestDay')}
							onClick={() => removeRestDayAfter(i)}
						>
							<IoTrashOutline aria-hidden className="h-3.5 w-3.5" />
						</MapControlIconButton>
					</div>
				);
			})}
		</>
	);
});
