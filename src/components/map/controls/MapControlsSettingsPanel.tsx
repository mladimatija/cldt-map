'use client';

import React, { useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { usePopoverFocusTrap } from '@/hooks';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Checkbox } from '@/components/ui/Checkbox';
import { formatPace } from '@/lib/distance-utils';
import {
	displayToKg,
	displayToLph,
	kgToDisplay,
	lphToDisplay,
	PACK_ETA_REFERENCE_KG,
	formatWeight,
	volumeUnitLabel,
	weightUnitLabel,
} from '@/lib/pack-weight';
import { parsePackCsv } from '@/lib/pack-csv';
import { disablePushAlerts, enablePushAlerts, pushAlertsSupported } from '@/lib/push-alerts';
import { useMapStore, type MapStoreState } from '@/lib/store';
import {
	IoMoonOutline,
	IoSunnyOutline,
	IoTrailSignOutline,
	IoBatteryHalfOutline,
	IoCompassOutline,
	IoHandLeftOutline,
	IoLayersOutline,
	IoSettingsOutline,
	IoHelpCircleOutline,
	IoAlertCircleOutline,
	IoWarningOutline,
	IoSnowOutline,
	IoFlagOutline,
} from 'react-icons/io5';
import { severityColor, type SeasonalSeverity } from '@/lib/seasonal-status';
import { GRADE_BAND_ASCENT_COLORS, SAC_COLORS, SURFACE_COLORS } from '@/components/map/trail-route-constants';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { MAP_CONTROL_INPUT, MAP_CONTROL_POPOVER } from './map-controls-constants';
import { MapControlsTileCachePanel } from './MapControlsTileCachePanel';
import { MapControlsImportsPanel } from './MapControlsImportsPanel';
// From the shared constants module, NOT the chart component: importing the
// component would statically pull recharts into the main bundle and defeat
// the dynamic() split on ElevationChart.
import { SURFACE_BUCKETS } from '@/components/charts/elevation-chart-shared';
import { requestCompassPermission } from '@/hooks/useCompassHeading';
import { Radio } from '@/components/ui/Radio';

interface MapControlsSettingsPanelProps {
	containerRef: RefObject<HTMLDivElement | null>;
	isExpanded: boolean;
	onToggle: () => void;
}

/** Settings popover: dark mode, battery saver, large touch targets, show sections. */
export function MapControlsSettingsPanel({
	containerRef,
	isExpanded,
	onToggle,
}: MapControlsSettingsPanelProps): React.ReactElement {
	const t = useTranslations('mapControls');
	const tWeather = useTranslations('severeWeather');
	const tMineAreas = useTranslations('mineAreas');
	const tSeasonal = useTranslations('seasonalStatus');
	const popoverRef = usePopoverFocusTrap(isExpanded);

	const darkMode = useMapStore((state: MapStoreState) => state.darkMode);
	const setDarkMode = useMapStore((state: MapStoreState) => state.setDarkMode);
	const batterySaverMode = useMapStore((state: MapStoreState) => state.batterySaverMode);
	const setBatterySaverMode = useMapStore((state: MapStoreState) => state.setBatterySaverMode);
	const largeTouchTargets = useMapStore((state: MapStoreState) => state.largeTouchTargets);
	const setLargeTouchTargets = useMapStore((state: MapStoreState) => state.setLargeTouchTargets);
	const compassEnabled = useMapStore((state: MapStoreState) => state.compassEnabled);
	const setCompassEnabled = useMapStore((state: MapStoreState) => state.setCompassEnabled);
	const keepScreenOn = useMapStore((state: MapStoreState) => state.keepScreenOn);
	const setKeepScreenOn = useMapStore((state: MapStoreState) => state.setKeepScreenOn);
	const offRouteAlertEnabled = useMapStore((state: MapStoreState) => state.offRouteAlertEnabled);
	const setOffRouteAlertEnabled = useMapStore((state: MapStoreState) => state.setOffRouteAlertEnabled);

	/** iOS gates DeviceOrientation behind a permission prompt that must run
	 *  inside this user-gesture handler; only enable when events may flow. */
	const handleCompassToggle = async (checked: boolean): Promise<void> => {
		if (!checked) {
			setCompassEnabled(false);
			return;
		}
		const granted = await requestCompassPermission();
		setCompassEnabled(granted);
	};
	const showSections = useMapStore((state: MapStoreState) => state.showSections);
	const setShowSections = useMapStore((state: MapStoreState) => state.setShowSections);
	const gradeTintedTrail = useMapStore((state: MapStoreState) => state.gradeTintedTrail);
	const setGradeTintedTrail = useMapStore((state: MapStoreState) => state.setGradeTintedTrail);
	const surfaceColoured = useMapStore((state: MapStoreState) => state.surfaceColoured);
	const setSurfaceColoured = useMapStore((state: MapStoreState) => state.setSurfaceColoured);
	const sacColoured = useMapStore((state: MapStoreState) => state.sacColoured);
	const setSacColoured = useMapStore((state: MapStoreState) => state.setSacColoured);
	const trailOsmTagsFile = useMapStore((state: MapStoreState) => state.trailOsmTagsFile);
	const showDistanceMarkers = useMapStore((state: MapStoreState) => state.showDistanceMarkers);
	const setShowDistanceMarkers = useMapStore((state: MapStoreState) => state.setShowDistanceMarkers);
	const walkingPaceKmh = useMapStore((state: MapStoreState) => state.walkingPaceKmh);
	const setWalkingPaceKmh = useMapStore((state: MapStoreState) => state.setWalkingPaceKmh);
	const gradeAdjustedEta = useMapStore((state: MapStoreState) => state.gradeAdjustedEta);
	const setGradeAdjustedEta = useMapStore((state: MapStoreState) => state.setGradeAdjustedEta);
	const sunsetProjection = useMapStore((state: MapStoreState) => state.sunsetProjection);
	const setSunsetProjection = useMapStore((state: MapStoreState) => state.setSunsetProjection);
	const showUpNext = useMapStore((state: MapStoreState) => state.showUpNext);
	const setShowUpNext = useMapStore((state: MapStoreState) => state.setShowUpNext);
	const packBaseWeightKg = useMapStore((state: MapStoreState) => state.packBaseWeightKg);
	const setPackBaseWeightKg = useMapStore((state: MapStoreState) => state.setPackBaseWeightKg);
	const waterConsumptionLph = useMapStore((state: MapStoreState) => state.waterConsumptionLph);
	const setWaterConsumptionLph = useMapStore((state: MapStoreState) => state.setWaterConsumptionLph);
	const packEtaAdjust = useMapStore((state: MapStoreState) => state.packEtaAdjust);
	const setPackEtaAdjust = useMapStore((state: MapStoreState) => state.setPackEtaAdjust);
	const packGearList = useMapStore((state: MapStoreState) => state.packGearList);
	const setPackGearList = useMapStore((state: MapStoreState) => state.setPackGearList);
	const severeWeatherLayer = useMapStore((state: MapStoreState) => state.severeWeatherLayer);
	const setSevereWeatherLayer = useMapStore((state: MapStoreState) => state.setSevereWeatherLayer);
	const mineAreasEnabled = useMapStore((state: MapStoreState) => state.mineAreasEnabled);
	const setMineAreasEnabled = useMapStore((state: MapStoreState) => state.setMineAreasEnabled);
	const mineAreasFile = useMapStore((state: MapStoreState) => state.mineAreasFile);
	const seasonalStatusLayerEnabled = useMapStore((state: MapStoreState) => state.seasonalStatusLayerEnabled);
	const setSeasonalStatusLayerEnabled = useMapStore((state: MapStoreState) => state.setSeasonalStatusLayerEnabled);
	const seasonalStatusFile = useMapStore((state: MapStoreState) => state.seasonalStatusFile);
	const pushAlertsEnabled = useMapStore((state: MapStoreState) => state.pushAlertsEnabled);
	const setPushAlertsEnabled = useMapStore((state: MapStoreState) => state.setPushAlertsEnabled);
	const waymarkedTrailsOverlay = useMapStore((state: MapStoreState) => state.waymarkedTrailsOverlay);
	const setWaymarkedTrailsOverlay = useMapStore((state: MapStoreState) => state.setWaymarkedTrailsOverlay);
	const shareShortLinks = useMapStore((state: MapStoreState) => state.shareShortLinks);
	const setShareShortLinks = useMapStore((state: MapStoreState) => state.setShareShortLinks);
	const includeRemotePois = useMapStore((state: MapStoreState) => state.includeRemotePois);
	const setIncludeRemotePois = useMapStore((state: MapStoreState) => state.setIncludeRemotePois);

	/** Permission prompt must run inside this click handler; failures (denied,
	 *  unsupported, deploy without VAPID keys) revert the toggle silently. */
	const handlePushAlertsToggle = async (checked: boolean): Promise<void> => {
		if (!checked) {
			setPushAlertsEnabled(false);
			void disablePushAlerts();
			return;
		}
		setPushAlertsEnabled(await enablePushAlerts());
	};
	const units = useMapStore((state: MapStoreState) => state.units);

	// Capture "now" once at mount via a lazy useState init
	// so the days-ago display stays pure during render
	// while still reflecting the active dataset's lastUpdated value.
	const [nowMs] = useState(() => Date.now());
	const packCsvInputRef = useRef<HTMLInputElement>(null);
	const [packCsvError, setPackCsvError] = useState(false);

	/** LighterPack / Packstack CSV import: fills the gear list and the base
	 *  weight field in one go. Parsing is synchronous and local. */
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
	const seasonalLastUpdatedDays: number | null = ((): number | null => {
		if (!seasonalStatusFile?.lastUpdated) return null;
		const ts = Date.parse(seasonalStatusFile.lastUpdated);
		if (Number.isNaN(ts)) return null;
		return Math.max(0, Math.round((nowMs - ts) / 86_400_000));
	})();

	const preferencesTitle = t('preferences');
	const tooltipShow = t('preferencesShow');
	const tooltipHide = t('preferencesHide');

	return (
		<div className="relative inline-block w-10 shrink-0" ref={containerRef}>
			{isExpanded && (
				<div
					aria-labelledby="settings-panel-title"
					aria-modal="true"
					className={cn(
						MAP_CONTROL_POPOVER,
						'fixed top-2 right-16 flex max-h-[calc(100dvh-4rem)] w-80 flex-col gap-2 overflow-y-auto',
					)}
					ref={popoverRef}
					role="dialog"
				>
					<h3 className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]" id="settings-panel-title">
						{preferencesTitle}
					</h3>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={darkMode} onCheckedChange={(checked) => setDarkMode(checked)} />
						<IoMoonOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('darkMode')}</span>
					</label>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={batterySaverMode} onCheckedChange={(checked) => setBatterySaverMode(checked)} />
						<IoBatteryHalfOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('batterySaver')}</span>
						<span className="inline-flex" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
							<SmartTooltip content={t('batterySaverTooltip')} position="top">
								<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
							</SmartTooltip>
						</span>
					</label>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={largeTouchTargets} onCheckedChange={(checked) => setLargeTouchTargets(checked)} />
						<IoHandLeftOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('largeTouchTargets')}</span>
					</label>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={compassEnabled} onCheckedChange={(checked) => void handleCompassToggle(checked)} />
						<IoCompassOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('compassHeading')}</span>
						<span className="inline-flex" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
							<SmartTooltip content={t('compassHeadingTooltip')} position="top">
								<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
							</SmartTooltip>
						</span>
					</label>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={keepScreenOn} onCheckedChange={(checked) => setKeepScreenOn(checked)} />
						<IoSunnyOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('keepScreenOn')}</span>
						<span className="inline-flex" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
							<SmartTooltip content={t('keepScreenOnTooltip')} position="top">
								<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
							</SmartTooltip>
						</span>
					</label>
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={offRouteAlertEnabled} onCheckedChange={(checked) => setOffRouteAlertEnabled(checked)} />
						<IoTrailSignOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('offRouteAlert')}</span>
						<span className="inline-flex" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
							<SmartTooltip content={t('offRouteAlertTooltip')} position="top">
								<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
							</SmartTooltip>
						</span>
					</label>
					<p className="mt-1 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
						{t('layersSection')}
					</p>
					<fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
						<legend className="mb-1 flex items-center gap-2 p-0 text-sm text-gray-700 dark:text-[var(--text-primary)]">
							<IoLayersOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
							<span>{t('layers.trailStyle.legend')}</span>
							<span
								className="inline-flex"
								onClick={(e) => e.stopPropagation()}
								onMouseDown={(e) => e.stopPropagation()}
							>
								<SmartTooltip content={t('layers.trailStyle.tooltip')} position="top">
									<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
								</SmartTooltip>
							</span>
						</legend>
						{(() => {
							const selected = sacColoured
								? 'sac'
								: surfaceColoured
									? 'surface'
									: gradeTintedTrail
										? 'grade'
										: showSections
											? 'sections'
											: 'default';
							// Surface / SAC require the OSM tag dataset. Disable until it loads
							// so the user can't pick a style with no data behind it.
							const osmReady = Boolean(trailOsmTagsFile?.runs?.length);
							return (['default', 'sections', 'grade', 'surface', 'sac'] as const).map((option) => {
								const disabled = (option === 'surface' || option === 'sac') && !osmReady;
								return (
									<label
										className={cn(
											'flex items-center gap-2 pl-6',
											disabled ? 'pointer-events-none cursor-not-allowed opacity-50' : 'cursor-pointer',
										)}
										key={option}
									>
										<Radio
											checked={selected === option}
											disabled={disabled}
											name="trail-style"
											value={option}
											onChange={() => {
												if (option === 'sac') {
													setSacColoured(true);
												} else if (option === 'surface') {
													setSurfaceColoured(true);
												} else if (option === 'grade') {
													setGradeTintedTrail(true);
												} else if (option === 'sections') {
													setShowSections(true);
												} else {
													setShowSections(false);
													setGradeTintedTrail(false);
													setSurfaceColoured(false);
													setSacColoured(false);
												}
											}}
										/>
										<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">
											{t(`layers.trailStyle.${option}`)}
											{disabled && (
												<span className="ml-1 text-xs italic opacity-75">
													({t('layers.trailStyle.dataUnavailable')})
												</span>
											)}
										</span>
									</label>
								);
							});
						})()}
					</fieldset>
					{gradeTintedTrail && (
						<div className="ml-6 flex flex-col gap-1 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
							<p className="font-semibold text-gray-700 dark:text-[var(--text-primary)]">
								{t('layers.trailStyle.legendTitle')}
							</p>
							{(
								[
									{ band: 0, key: 'legendFlat', range: '0-3%' },
									{ band: 1, key: 'legendModerate', range: '3-6%' },
									{ band: 2, key: 'legendSteep', range: '6-10%' },
									{ band: 3, key: 'legendVerySteep', range: '10-15%' },
									{ band: 4, key: 'legendExtreme', range: '>15%' },
								] as const
							).map(({ band, key, range }) => (
								<div className="flex items-center gap-2" key={key}>
									<span
										aria-hidden="true"
										className="inline-block h-2 w-6 shrink-0 rounded-sm"
										style={{ backgroundColor: GRADE_BAND_ASCENT_COLORS[band] }}
									/>
									<span>
										{t(`layers.trailStyle.${key}`)} ({range})
									</span>
								</div>
							))}
							<p className="mt-0.5 text-xs italic opacity-75">{t('layers.trailStyle.legendNote')}</p>
						</div>
					)}
					{surfaceColoured && (
						<div className="ml-6 flex flex-col gap-1 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
							<p className="font-semibold text-gray-700 dark:text-[var(--text-primary)]">
								{t('layers.trailStyle.surfaceLegendTitle')}
							</p>
							{SURFACE_BUCKETS.map((bucket) => (
								<div className="flex items-center gap-2" key={bucket}>
									<span
										aria-hidden="true"
										className="inline-block h-2 w-6 shrink-0 rounded-sm"
										style={{ backgroundColor: SURFACE_COLORS[bucket] }}
									/>
									<span>{t(`layers.trailStyle.surfaceBuckets.${bucket}`)}</span>
								</div>
							))}
						</div>
					)}
					{sacColoured && (
						<div className="ml-6 flex flex-col gap-1 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
							<p className="font-semibold text-gray-700 dark:text-[var(--text-primary)]">
								{t('layers.trailStyle.sacLegendTitle')}
							</p>
							{(
								[
									{ key: 'hiking', label: 'T1' },
									{ key: 'mountain_hiking', label: 'T2' },
									{ key: 'demanding_mountain_hiking', label: 'T3' },
									{ key: 'alpine_hiking', label: 'T4' },
									{ key: 'demanding_alpine_hiking', label: 'T5' },
									{ key: 'difficult_alpine_hiking', label: 'T6' },
									{ key: 'untagged', label: '-' },
								] as const
							).map(({ key, label }) => (
								<div className="flex items-center gap-2" key={key}>
									<span
										aria-hidden="true"
										className="inline-block h-2 w-6 shrink-0 rounded-sm"
										style={{ backgroundColor: SAC_COLORS[key] }}
									/>
									<span>
										<span className="font-mono">{label}</span> {t(`layers.trailStyle.sacBuckets.${key}`)}
									</span>
								</div>
							))}
						</div>
					)}
					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={showDistanceMarkers} onCheckedChange={(checked) => setShowDistanceMarkers(checked)} />
						<IoFlagOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('showDistanceMarkers')}</span>
						<span className="inline-flex" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
							<SmartTooltip content={t('showDistanceMarkersTooltip')} position="top">
								<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
							</SmartTooltip>
						</span>
					</label>

					<label className="flex cursor-pointer items-center gap-2">
						<Checkbox checked={severeWeatherLayer} onCheckedChange={(checked) => setSevereWeatherLayer(checked)} />
						<IoWarningOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
						<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{tWeather('layerLabel')}</span>
						<span className="inline-flex" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
							<SmartTooltip content={tWeather('layerTooltip')} position="top">
								<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
							</SmartTooltip>
						</span>
					</label>

					{mineAreasFile && mineAreasFile.areas.length > 0 && (
						<label className="flex cursor-pointer items-center gap-2">
							<Checkbox checked={mineAreasEnabled} onCheckedChange={(checked) => setMineAreasEnabled(checked)} />
							<IoAlertCircleOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
							<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{tMineAreas('layerLabel')}</span>
							<span
								className="inline-flex"
								onClick={(e) => e.stopPropagation()}
								onMouseDown={(e) => e.stopPropagation()}
							>
								<SmartTooltip content={tMineAreas('layerTooltip')} position="top">
									<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
								</SmartTooltip>
							</span>
						</label>
					)}

					{seasonalStatusFile && (
						<label className="flex cursor-pointer items-center gap-2">
							<Checkbox
								checked={seasonalStatusLayerEnabled}
								onCheckedChange={(checked) => setSeasonalStatusLayerEnabled(checked)}
							/>
							<IoSnowOutline className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
							<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{tSeasonal('layerToggle')}</span>
							<span
								className="inline-flex"
								onClick={(e) => e.stopPropagation()}
								onMouseDown={(e) => e.stopPropagation()}
							>
								<SmartTooltip content={tSeasonal('layerTooltip')} position="top">
									<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
								</SmartTooltip>
							</span>
						</label>
					)}
					{seasonalStatusFile && seasonalStatusLayerEnabled && (
						<div className="ml-6 flex flex-col gap-1 text-xs text-gray-700 dark:text-[var(--text-primary)]">
							{(['open', 'caution', 'closed_recommended', 'experts_only'] as SeasonalSeverity[]).map((sev) => (
								<div className="flex items-center gap-2" key={sev}>
									<span
										aria-hidden="true"
										className="inline-block h-3 w-4 shrink-0 rounded-sm"
										style={{ backgroundColor: severityColor(sev) }}
									/>
									<span>{tSeasonal(`severity.${sev}`)}</span>
								</div>
							))}
							{seasonalLastUpdatedDays !== null && (
								<p className="mt-0.5 text-xs italic opacity-75">
									{tSeasonal('lastUpdatedDaysAgo', { days: seasonalLastUpdatedDays })}
								</p>
							)}
						</div>
					)}

					{pushAlertsSupported() && (
						<label className="flex cursor-pointer items-start gap-2">
							<Checkbox
								checked={pushAlertsEnabled}
								onCheckedChange={(checked) => void handlePushAlertsToggle(checked)}
							/>
							<div className="flex flex-col">
								<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('pushAlertsLabel')}</span>
								<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('pushAlertsHint')}</span>
							</div>
						</label>
					)}

					<label className="flex cursor-pointer items-start gap-2">
						<Checkbox checked={includeRemotePois} onCheckedChange={(checked) => setIncludeRemotePois(checked)} />
						<div className="flex flex-col">
							<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">
								{t('includeRemotePoisLabel')}
							</span>
							<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
								{t('includeRemotePoisHint')}
							</span>
						</div>
					</label>

					<label className="flex cursor-pointer items-start gap-2">
						<Checkbox checked={shareShortLinks} onCheckedChange={(checked) => setShareShortLinks(checked)} />
						<div className="flex flex-col">
							<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('shareShortLinksLabel')}</span>
							<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
								{t('shareShortLinksHint')}
							</span>
						</div>
					</label>

					<label className="flex cursor-pointer items-start gap-2">
						<Checkbox
							checked={waymarkedTrailsOverlay}
							onCheckedChange={(checked) => setWaymarkedTrailsOverlay(checked)}
						/>
						<div className="flex flex-col">
							<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('waymarkedLabel')}</span>
							<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('waymarkedHint')}</span>
						</div>
					</label>

					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2">
							<label className="text-sm text-gray-700 dark:text-[var(--text-primary)]" htmlFor="walking-pace-slider">
								{t('walkingPace')}
							</label>
							<span className="text-cldt-blue ml-auto shrink-0 text-sm font-semibold tabular-nums">
								{formatPace(walkingPaceKmh, units)}
							</span>
							{walkingPaceKmh !== 4 && (
								<button
									aria-label={t('walkingPaceReset')}
									className="text-cldt-blue focus-visible:ring-cldt-green min-h-[var(--min-touch-target)] min-w-[var(--min-touch-target)] cursor-pointer rounded border-0 bg-transparent p-0 text-sm underline outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
									type="button"
									onClick={() => setWalkingPaceKmh(4)}
								>
									{t('walkingPaceReset')}
								</button>
							)}
						</div>
						<input
							className="precision-slider w-full min-w-0"
							id="walking-pace-slider"
							max={10}
							min={1}
							step={0.1}
							type="range"
							value={walkingPaceKmh}
							onChange={(e) => setWalkingPaceKmh(Number(e.target.value))}
						/>
						<p className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
							{t('walkingPaceHint', {
								min: formatPace(1, units),
								max: formatPace(10, units),
								default: formatPace(4, units),
							})}
						</p>
					</div>

					<label className="flex cursor-pointer items-start gap-2">
						<Checkbox checked={gradeAdjustedEta} onCheckedChange={(checked) => setGradeAdjustedEta(checked)} />
						<div className="flex flex-col">
							<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">
								{t('gradeAdjustedEtaLabel')}
							</span>
							<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
								{t('gradeAdjustedEtaHint')}
							</span>
						</div>
					</label>

					<label className="flex cursor-pointer items-start gap-2">
						<Checkbox checked={sunsetProjection} onCheckedChange={(checked) => setSunsetProjection(checked)} />
						<div className="flex flex-col">
							<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">
								{t('sunsetProjectionLabel')}
							</span>
							<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
								{t('sunsetProjectionHint')}
							</span>
						</div>
					</label>

					<label className="flex cursor-pointer items-start gap-2">
						<Checkbox checked={showUpNext} onCheckedChange={(checked) => setShowUpNext(checked)} />
						<div className="flex flex-col">
							<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('showUpNextLabel')}</span>
							<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('showUpNextHint')}</span>
						</div>
					</label>

					<div className="flex flex-col gap-1.5">
						<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('packWeightTitle')}</span>
						<label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-400">
							{t('packBaseWeightLabel')}
							<span className="flex shrink-0 items-center gap-1">
								<input
									className={cn(MAP_CONTROL_INPUT, 'w-20 text-right')}
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
								<span className="w-5">{weightUnitLabel(units)}</span>
							</span>
						</label>
						<label className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-400">
							{t('waterConsumptionLabel')}
							<span className="flex shrink-0 items-center gap-1">
								<input
									className={cn(MAP_CONTROL_INPUT, 'w-20 text-right')}
									min={0.1}
									step={0.1}
									type="number"
									value={Math.round(lphToDisplay(waterConsumptionLph, units) * 100) / 100}
									onChange={(e) => {
										const v = Number(e.target.value);
										if (Number.isFinite(v) && v > 0) setWaterConsumptionLph(displayToLph(v, units));
									}}
								/>
								<span className="w-5">{volumeUnitLabel(units)}/h</span>
							</span>
						</label>
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
							<div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
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
							<Button size="sm" variant="mapControlOutlineSecondary" onClick={() => packCsvInputRef.current?.click()}>
								{t('packCsvImport')}
							</Button>
						)}
						{packCsvError && <p className="text-cldt-red m-0 text-xs">{t('packCsvError')}</p>}
					</div>

					<label className="flex cursor-pointer items-start gap-2">
						<Checkbox checked={packEtaAdjust} onCheckedChange={(checked) => setPackEtaAdjust(checked)} />
						<div className="flex flex-col">
							<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('packEtaAdjustLabel')}</span>
							<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
								{t('packEtaAdjustHint', { reference: formatWeight(PACK_ETA_REFERENCE_KG, units) })}
							</span>
						</div>
					</label>

					<MapControlsTileCachePanel />

					<MapControlsImportsPanel />
				</div>
			)}
			<SmartTooltip content={isExpanded ? tooltipHide : tooltipShow} position="left">
				<Button
					aria-label={isExpanded ? tooltipHide : tooltipShow}
					variant={isExpanded ? 'controlRoundActive' : 'controlRound'}
					onClick={onToggle}
				>
					<IoSettingsOutline aria-hidden className="h-5 w-5" />
				</Button>
			</SmartTooltip>
		</div>
	);
}
