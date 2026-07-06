'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { useClientLocale } from '@/components/providers/ClientIntlProvider';
import { usePopoverFocusTrap } from '@/hooks';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { formatPace } from '@/lib/distance-utils';
import {
	displayToKg,
	displayToLph,
	kgToDisplay,
	lphToDisplay,
	PACE_FACTOR_DEFAULT,
	PACE_FACTOR_MAX,
	PACE_FACTOR_MIN,
	PACK_ETA_REFERENCE_KG,
	formatWeight,
	volumeUnitLabel,
	weightUnitLabel,
} from '@/lib/pack-weight';
import { parsePackCsv } from '@/lib/pack-csv';
import { disablePushAlerts, enablePushAlerts, pushAlertsSupported } from '@/lib/push-alerts';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { UI_TEXT_SCALES } from '@/lib/ui-text-scale';
import {
	IoLanguageOutline,
	IoMoonOutline,
	IoSunnyOutline,
	IoTrailSignOutline,
	IoBatteryHalfOutline,
	IoCompassOutline,
	IoHandLeftOutline,
	IoTextOutline,
	IoLayersOutline,
	IoSettingsOutline,
	IoAlertCircleOutline,
	IoWarningOutline,
	IoSnowOutline,
	IoFlagOutline,
	IoRefreshOutline,
	IoCloudUploadOutline,
} from 'react-icons/io5';
import { severityColor, type SeasonalSeverity } from '@/lib/seasonal-status';
import {
	GRADE_BAND_ASCENT_COLORS,
	SAC_BUCKET_SHORT_LABELS,
	SAC_COLORS,
	SURFACE_COLORS,
} from '@/components/map/trail-route-constants';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import {
	MAP_CONTROL_INPUT,
	MAP_CONTROL_LABEL_INPUT_GRID,
	MAP_CONTROL_PANEL_WIDTH,
	MAP_CONTROL_POPOVER,
} from './map-controls-constants';
import { MapControlsTileCachePanel } from './MapControlsTileCachePanel';
import { MapControlsImportsPanel } from './MapControlsImportsPanel';
import { SAC_BUCKETS, SURFACE_BUCKETS } from '@/components/charts/elevation-chart-shared';
import { requestCompassPermission } from '@/hooks/useCompassHeading';
import { Radio } from '@/components/ui/Radio';
import { MapControlSectionCard } from './MapControlSectionCard';
import { MapControlSingleSelect } from './MapControlSelect';
import { MapControlIconButton } from './MapControlIconButton';
import { SettingsToggleRow } from './SettingsToggleRow';

interface MapControlsSettingsPanelProps {
	containerRef: RefObject<HTMLDivElement | null>;
	isExpanded: boolean;
	onToggle: () => void;
}

const LEGEND_PANEL =
	'rounded border border-gray-100 bg-gray-50 p-2 text-xs text-gray-600 dark:border-[var(--border-color)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';

type LanguageOption = { value: Locale; label: string };

/** Settings popover: dark mode, battery saver, large touch targets, show sections. */
export function MapControlsSettingsPanel({
	containerRef,
	isExpanded,
	onToggle,
}: MapControlsSettingsPanelProps): React.ReactElement {
	const t = useTranslations('mapControls');
	const tProgress = useTranslations('progress');
	const tWeather = useTranslations('severeWeather');
	const tMineAreas = useTranslations('mineAreas');
	const tSeasonal = useTranslations('seasonalStatus');
	const tFooter = useTranslations('footer');
	const activeLocale = useLocale() as Locale;
	const pathname = usePathname();
	const router = useRouter();
	const { setLocale } = useClientLocale();
	const popoverRef = usePopoverFocusTrap(isExpanded);
	const settingsScrollTarget = useMapStore((state: MapStoreState) => state.settingsScrollTarget);
	const clearSettingsScrollTarget = useMapStore((state: MapStoreState) => state.clearSettingsScrollTarget);
	const settingsPanelOverlaysOpen = useMapStore((state: MapStoreState) => state.settingsPanelOverlaysOpen);
	const setSettingsPanelOverlaysOpen = useMapStore((state: MapStoreState) => state.setSettingsPanelOverlaysOpen);
	const settingsPanelPackOpen = useMapStore((state: MapStoreState) => state.settingsPanelPackOpen);
	const setSettingsPanelPackOpen = useMapStore((state: MapStoreState) => state.setSettingsPanelPackOpen);
	const settingsPanelNotificationsOpen = useMapStore((state: MapStoreState) => state.settingsPanelNotificationsOpen);
	const setSettingsPanelNotificationsOpen = useMapStore(
		(state: MapStoreState) => state.setSettingsPanelNotificationsOpen,
	);
	const settingsPanelOfflineOpen = useMapStore((state: MapStoreState) => state.settingsPanelOfflineOpen);
	const setSettingsPanelOfflineOpen = useMapStore((state: MapStoreState) => state.setSettingsPanelOfflineOpen);
	const settingsPanelImportsOpen = useMapStore((state: MapStoreState) => state.settingsPanelImportsOpen);
	const setSettingsPanelImportsOpen = useMapStore((state: MapStoreState) => state.setSettingsPanelImportsOpen);
	const tileCacheMeta = useMapStore((state: MapStoreState) => state.tileCacheMeta);

	const offlineSectionOpen = settingsPanelOfflineOpen ?? !!tileCacheMeta;

	useEffect(() => {
		if (!isExpanded || settingsScrollTarget !== 'imports') return;
		setSettingsPanelImportsOpen(true);
		const el = document.getElementById('settings-imports-section');
		el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		clearSettingsScrollTarget();
	}, [isExpanded, settingsScrollTarget, clearSettingsScrollTarget, setSettingsPanelImportsOpen]);

	const darkMode = useMapStore((state: MapStoreState) => state.darkMode);
	const setDarkMode = useMapStore((state: MapStoreState) => state.setDarkMode);
	const batterySaverMode = useMapStore((state: MapStoreState) => state.batterySaverMode);
	const setBatterySaverMode = useMapStore((state: MapStoreState) => state.setBatterySaverMode);
	const largeTouchTargets = useMapStore((state: MapStoreState) => state.largeTouchTargets);
	const setLargeTouchTargets = useMapStore((state: MapStoreState) => state.setLargeTouchTargets);
	const uiTextScale = useMapStore((state: MapStoreState) => state.uiTextScale);
	const setUiTextScale = useMapStore((state: MapStoreState) => state.setUiTextScale);
	const compassEnabled = useMapStore((state: MapStoreState) => state.compassEnabled);
	const setCompassEnabled = useMapStore((state: MapStoreState) => state.setCompassEnabled);
	const keepScreenOn = useMapStore((state: MapStoreState) => state.keepScreenOn);
	const setKeepScreenOn = useMapStore((state: MapStoreState) => state.setKeepScreenOn);
	const offRouteAlertEnabled = useMapStore((state: MapStoreState) => state.offRouteAlertEnabled);
	const setOffRouteAlertEnabled = useMapStore((state: MapStoreState) => state.setOffRouteAlertEnabled);

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
	const paceFactor = useMapStore((state: MapStoreState) => state.paceFactor);
	const setPaceFactor = useMapStore((state: MapStoreState) => state.setPaceFactor);
	const gradeAdjustedEta = useMapStore((state: MapStoreState) => state.gradeAdjustedEta);
	const setGradeAdjustedEta = useMapStore((state: MapStoreState) => state.setGradeAdjustedEta);
	const sunsetProjection = useMapStore((state: MapStoreState) => state.sunsetProjection);
	const setSunsetProjection = useMapStore((state: MapStoreState) => state.setSunsetProjection);
	const showUpNext = useMapStore((state: MapStoreState) => state.showUpNext);
	const setShowUpNext = useMapStore((state: MapStoreState) => state.setShowUpNext);
	const upNextShowFood = useMapStore((state: MapStoreState) => state.upNextShowFood);
	const setUpNextShowFood = useMapStore((state: MapStoreState) => state.setUpNextShowFood);
	const upNextShowAtm = useMapStore((state: MapStoreState) => state.upNextShowAtm);
	const setUpNextShowAtm = useMapStore((state: MapStoreState) => state.setUpNextShowAtm);
	const upNextShowViewpoint = useMapStore((state: MapStoreState) => state.upNextShowViewpoint);
	const setUpNextShowViewpoint = useMapStore((state: MapStoreState) => state.setUpNextShowViewpoint);
	const upNextShowPharmacy = useMapStore((state: MapStoreState) => state.upNextShowPharmacy);
	const setUpNextShowPharmacy = useMapStore((state: MapStoreState) => state.setUpNextShowPharmacy);
	const packBaseWeightKg = useMapStore((state: MapStoreState) => state.packBaseWeightKg);
	const setPackBaseWeightKg = useMapStore((state: MapStoreState) => state.setPackBaseWeightKg);
	const waterConsumptionLph = useMapStore((state: MapStoreState) => state.waterConsumptionLph);
	const setWaterConsumptionLph = useMapStore((state: MapStoreState) => state.setWaterConsumptionLph);
	const foodConsumptionKgPerDay = useMapStore((state: MapStoreState) => state.foodConsumptionKgPerDay);
	const setFoodConsumptionKgPerDay = useMapStore((state: MapStoreState) => state.setFoodConsumptionKgPerDay);
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

	const handlePushAlertsToggle = async (checked: boolean): Promise<void> => {
		if (!checked) {
			setPushAlertsEnabled(false);
			void disablePushAlerts();
			return;
		}
		setPushAlertsEnabled(await enablePushAlerts());
	};

	const units = useMapStore((state: MapStoreState) => state.units);

	const [nowMs] = useState(() => Date.now());
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

	const seasonalLastUpdatedDays: number | null = ((): number | null => {
		if (!seasonalStatusFile?.lastUpdated) return null;
		const ts = Date.parse(seasonalStatusFile.lastUpdated);
		if (Number.isNaN(ts)) return null;
		return Math.max(0, Math.round((nowMs - ts) / 86_400_000));
	})();

	const trailStyleSelected = sacColoured
		? 'sac'
		: surfaceColoured
			? 'surface'
			: gradeTintedTrail
				? 'grade'
				: showSections
					? 'sections'
					: 'default';
	const osmReady = Boolean(trailOsmTagsFile?.runs?.length);

	const languageSelectWrapRef = useRef<HTMLDivElement>(null);
	const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
	const languageOptions = useMemo<LanguageOption[]>(
		() => routing.locales.map((loc) => ({ value: loc, label: tFooter(loc) })),
		[tFooter],
	);
	const selectedLanguage = useMemo(
		() => languageOptions.find((o) => o.value === activeLocale) ?? null,
		[languageOptions, activeLocale],
	);
	const handleLanguageChange = useCallback(
		(opt: LanguageOption | null): void => {
			if (!opt) return;
			setLocale(opt.value);
			router.push(pathname, { locale: opt.value });
			setLanguageMenuOpen(false);
		},
		[setLocale, router, pathname],
	);
	// Leaflet's disableClickPropagation on this panel swallows the control's
	// pointerdown before react-select sees it, so toggle the menu natively and
	// portal it to document.body so the options stay clickable outside the
	// panel's overflow/stacking. The panel's outside-click close ignores the
	// portalled menu - see usePanelListeners.
	useEffect(() => {
		const wrap = languageSelectWrapRef.current;
		if (!wrap) return;
		const onControlPointerDown = (e: MouseEvent | TouchEvent): void => {
			if (!(e.target as Element).closest('.map-control-select__control')) return;
			e.stopPropagation();
			setLanguageMenuOpen((open) => !open);
		};
		wrap.addEventListener('mousedown', onControlPointerDown);
		wrap.addEventListener('touchstart', onControlPointerDown, { passive: true });
		return () => {
			wrap.removeEventListener('mousedown', onControlPointerDown);
			wrap.removeEventListener('touchstart', onControlPointerDown);
		};
	}, [isExpanded]);

	const sectionCollapseLabel = tProgress('collapseSection');
	const sectionExpandLabel = tProgress('expandSection');

	return (
		<div className="relative inline-block w-10 shrink-0" data-tour="offline" ref={containerRef}>
			{isExpanded && (
				<div
					aria-labelledby="settings-panel-title"
					aria-modal="true"
					className={cn(
						MAP_CONTROL_POPOVER,
						`fixed top-2 right-16 flex max-h-[calc(100dvh-4rem)] ${MAP_CONTROL_PANEL_WIDTH} flex-col gap-2 overflow-hidden`,
					)}
					ref={popoverRef}
					role="dialog"
				>
					<h3
						className="shrink-0 text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]"
						id="settings-panel-title"
					>
						{t('preferences')}
					</h3>

					<div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
						<div className="flex flex-col gap-2">
							<MapControlSectionCard title={t('sections.displayDevice')}>
								<div className="flex flex-col gap-2">
									<div className="flex items-center gap-2">
										<IoLanguageOutline aria-hidden className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
										<span className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]">
											{tFooter('language')}
										</span>
									</div>
									<div ref={languageSelectWrapRef}>
										<MapControlSingleSelect<LanguageOption>
											aria-label={tFooter('language')}
											instanceId="settings-language"
											menuIsOpen={languageMenuOpen}
											menuPortalTarget={typeof document === 'undefined' ? null : document.body}
											options={languageOptions}
											value={selectedLanguage}
											onChange={handleLanguageChange}
											onMenuClose={() => setLanguageMenuOpen(false)}
											onMenuOpen={() => setLanguageMenuOpen(true)}
										/>
									</div>
								</div>
								<SettingsToggleRow
									checked={darkMode}
									icon={<IoMoonOutline className="h-4 w-4" />}
									label={t('darkMode')}
									onCheckedChange={(checked) => setDarkMode(checked)}
								/>
								<SettingsToggleRow
									checked={batterySaverMode}
									icon={<IoBatteryHalfOutline className="h-4 w-4" />}
									label={t('batterySaver')}
									tooltip={t('batterySaverTooltip')}
									onCheckedChange={(checked) => setBatterySaverMode(checked)}
								/>
								<SettingsToggleRow
									checked={largeTouchTargets}
									icon={<IoHandLeftOutline className="h-4 w-4" />}
									label={t('largeTouchTargets')}
									tooltip={t('largeTouchTargetsTooltip')}
									onCheckedChange={(checked) => setLargeTouchTargets(checked)}
								/>
								<div className="flex flex-col gap-2">
									<div className="flex items-center gap-2">
										<IoTextOutline aria-hidden className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
										<span className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]">
											{t('textSize')}
										</span>
									</div>
									<div className="grid grid-cols-3 gap-1.5">
										{UI_TEXT_SCALES.map((scale) => (
											<label className="flex cursor-pointer items-center gap-2" key={scale}>
												<Radio
													checked={uiTextScale === scale}
													name="ui-text-scale"
													value={scale}
													onChange={() => setUiTextScale(scale)}
												/>
												<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">
													{t(`textSizeOption.${scale}`)}
												</span>
											</label>
										))}
									</div>
									<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('textSizeTooltip')}</p>
								</div>
								<SettingsToggleRow
									checked={compassEnabled}
									icon={<IoCompassOutline className="h-4 w-4" />}
									label={t('compassHeading')}
									tooltip={t('compassHeadingTooltip')}
									onCheckedChange={(checked) => void handleCompassToggle(checked)}
								/>
								<SettingsToggleRow
									checked={keepScreenOn}
									icon={<IoSunnyOutline className="h-4 w-4" />}
									label={t('keepScreenOn')}
									tooltip={t('keepScreenOnTooltip')}
									onCheckedChange={(checked) => setKeepScreenOn(checked)}
								/>
								<SettingsToggleRow
									checked={offRouteAlertEnabled}
									icon={<IoTrailSignOutline className="h-4 w-4" />}
									label={t('offRouteAlert')}
									tooltip={t('offRouteAlertTooltip')}
									onCheckedChange={(checked) => setOffRouteAlertEnabled(checked)}
								/>
							</MapControlSectionCard>

							<MapControlSectionCard title={t('sections.trailAppearance')}>
								<div className="flex flex-col gap-2">
									<div className="flex items-center gap-2">
										<IoLayersOutline aria-hidden className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
										<span className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]">
											{t('layers.trailStyle.legend')}
										</span>
									</div>
									<div className="grid grid-cols-2 gap-1.5">
										{(['default', 'sections', 'grade', 'surface', 'sac'] as const).map((option) => {
											const disabled = (option === 'surface' || option === 'sac') && !osmReady;
											return (
												<label
													className={cn(
														'flex items-center gap-2',
														disabled ? 'pointer-events-none cursor-not-allowed opacity-50' : 'cursor-pointer',
													)}
													key={option}
												>
													<Radio
														checked={trailStyleSelected === option}
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
										})}
									</div>
									<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
										{t('layers.trailStyle.tooltip')}
									</p>
								</div>

								{gradeTintedTrail && (
									<div className={LEGEND_PANEL}>
										<p className="m-0 mb-1 font-semibold text-gray-700 dark:text-[var(--text-primary)]">
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
										<p className="mt-1 mb-0 text-xs italic opacity-75">{t('layers.trailStyle.legendNote')}</p>
									</div>
								)}
								{surfaceColoured && (
									<div className={LEGEND_PANEL}>
										<p className="m-0 mb-1 font-semibold text-gray-700 dark:text-[var(--text-primary)]">
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
									<div className={LEGEND_PANEL}>
										<p className="m-0 mb-1 font-semibold text-gray-700 dark:text-[var(--text-primary)]">
											{t('layers.trailStyle.sacLegendTitle')}
										</p>
										{SAC_BUCKETS.map((key) => (
											<div className="flex items-center gap-2" key={key}>
												<span
													aria-hidden="true"
													className="inline-block h-2 w-6 shrink-0 rounded-sm"
													style={{ backgroundColor: SAC_COLORS[key] }}
												/>
												<span>
													<span className="font-mono">{SAC_BUCKET_SHORT_LABELS[key]}</span>{' '}
													{t(`layers.trailStyle.sacBuckets.${key}`)}
												</span>
											</div>
										))}
									</div>
								)}

								<SettingsToggleRow
									checked={showDistanceMarkers}
									icon={<IoFlagOutline className="h-4 w-4" />}
									label={t('showDistanceMarkers')}
									tooltip={t('showDistanceMarkersTooltip')}
									onCheckedChange={(checked) => setShowDistanceMarkers(checked)}
								/>
							</MapControlSectionCard>

							<MapControlSectionCard
								collapsible
								collapseLabel={sectionCollapseLabel}
								expandLabel={sectionExpandLabel}
								open={settingsPanelOverlaysOpen}
								title={t('sections.mapOverlays')}
								onOpenChange={setSettingsPanelOverlaysOpen}
							>
								<SettingsToggleRow
									checked={severeWeatherLayer}
									icon={<IoWarningOutline className="h-4 w-4" />}
									label={tWeather('layerLabel')}
									tooltip={tWeather('layerTooltip')}
									onCheckedChange={(checked) => setSevereWeatherLayer(checked)}
								/>

								{mineAreasFile && mineAreasFile.areas.length > 0 && (
									<SettingsToggleRow
										checked={mineAreasEnabled}
										icon={<IoAlertCircleOutline className="h-4 w-4" />}
										label={tMineAreas('layerLabel')}
										tooltip={tMineAreas('layerTooltip')}
										onCheckedChange={(checked) => setMineAreasEnabled(checked)}
									/>
								)}

								{seasonalStatusFile && (
									<SettingsToggleRow
										checked={seasonalStatusLayerEnabled}
										icon={<IoSnowOutline className="h-4 w-4" />}
										label={tSeasonal('layerToggle')}
										tooltip={tSeasonal('layerTooltip')}
										onCheckedChange={(checked) => setSeasonalStatusLayerEnabled(checked)}
									/>
								)}
								{seasonalStatusFile && seasonalStatusLayerEnabled && (
									<div className={LEGEND_PANEL}>
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
											<p className="mt-1 mb-0 text-xs italic opacity-75">
												{tSeasonal('lastUpdatedDaysAgo', { days: seasonalLastUpdatedDays })}
											</p>
										)}
									</div>
								)}

								<SettingsToggleRow
									checked={waymarkedTrailsOverlay}
									hint={t('waymarkedHint')}
									label={t('waymarkedLabel')}
									onCheckedChange={(checked) => setWaymarkedTrailsOverlay(checked)}
								/>
							</MapControlSectionCard>

							<MapControlSectionCard title={t('sections.walkingEta')}>
								<div className="flex flex-col gap-1">
									<div className="flex items-center gap-2">
										<label
											className="text-sm text-gray-700 dark:text-[var(--text-primary)]"
											htmlFor="walking-pace-slider"
										>
											{t('walkingPace')}
										</label>
										<span className="text-cldt-blue ml-auto shrink-0 text-sm font-semibold tabular-nums">
											{formatPace(walkingPaceKmh, units)}
										</span>
										{walkingPaceKmh !== 4 && (
											<MapControlIconButton
												aria-label={t('walkingPaceReset')}
												variant="mapControlOutlineSecondary"
												onClick={() => setWalkingPaceKmh(4)}
											>
												<IoRefreshOutline aria-hidden className="h-3.5 w-3.5" />
											</MapControlIconButton>
										)}
									</div>
									<input
										aria-valuetext={formatPace(walkingPaceKmh, units)}
										className="precision-slider w-full min-w-0"
										id="walking-pace-slider"
										max={10}
										min={1}
										step={0.1}
										type="range"
										value={walkingPaceKmh}
										onChange={(e) => setWalkingPaceKmh(Number(e.target.value))}
									/>
									<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
										{t('walkingPaceHint', {
											min: formatPace(1, units),
											max: formatPace(10, units),
											default: formatPace(4, units),
										})}
									</p>
								</div>

								<div className="flex flex-col gap-1">
									<div className="flex items-center gap-2">
										<label
											className="text-sm text-gray-700 dark:text-[var(--text-primary)]"
											htmlFor="pace-factor-slider"
										>
											{t('paceFactor')}
										</label>
										<span className="text-cldt-blue ml-auto shrink-0 text-sm font-semibold tabular-nums">
											{`${Math.round(paceFactor * 100)}%`}
										</span>
										{paceFactor !== PACE_FACTOR_DEFAULT && (
											<MapControlIconButton
												aria-label={t('paceFactorReset')}
												variant="mapControlOutlineSecondary"
												onClick={() => setPaceFactor(PACE_FACTOR_DEFAULT)}
											>
												<IoRefreshOutline aria-hidden className="h-3.5 w-3.5" />
											</MapControlIconButton>
										)}
									</div>
									<input
										aria-valuetext={`${Math.round(paceFactor * 100)}%`}
										className="precision-slider w-full min-w-0"
										id="pace-factor-slider"
										max={PACE_FACTOR_MAX}
										min={PACE_FACTOR_MIN}
										step={0.05}
										type="range"
										value={paceFactor}
										onChange={(e) => setPaceFactor(Number(e.target.value))}
									/>
									<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
										{t('paceFactorHint', {
											min: `${Math.round(PACE_FACTOR_MIN * 100)}%`,
											max: `${Math.round(PACE_FACTOR_MAX * 100)}%`,
										})}
									</p>
								</div>

								<SettingsToggleRow
									checked={gradeAdjustedEta}
									hint={t('gradeAdjustedEtaHint')}
									label={t('gradeAdjustedEtaLabel')}
									onCheckedChange={(checked) => setGradeAdjustedEta(checked)}
								/>
								<SettingsToggleRow
									checked={sunsetProjection}
									hint={t('sunsetProjectionHint')}
									label={t('sunsetProjectionLabel')}
									onCheckedChange={(checked) => setSunsetProjection(checked)}
								/>
								<SettingsToggleRow
									checked={showUpNext}
									hint={t('showUpNextHint')}
									label={t('showUpNextLabel')}
									onCheckedChange={(checked) => setShowUpNext(checked)}
								/>

								{showUpNext && (
									<div className="ml-6 flex flex-col gap-2">
										<SettingsToggleRow
											checked={upNextShowFood}
											label={t('upNextShowFoodLabel')}
											tooltip={t('upNextShowFoodHint')}
											onCheckedChange={(checked) => setUpNextShowFood(checked)}
										/>
										<SettingsToggleRow
											checked={upNextShowAtm}
											label={t('upNextShowAtmLabel')}
											tooltip={t('upNextShowAtmHint')}
											onCheckedChange={(checked) => setUpNextShowAtm(checked)}
										/>
										<SettingsToggleRow
											checked={upNextShowViewpoint}
											label={t('upNextShowViewpointLabel')}
											tooltip={t('upNextShowViewpointHint')}
											onCheckedChange={(checked) => setUpNextShowViewpoint(checked)}
										/>
										<SettingsToggleRow
											checked={upNextShowPharmacy}
											label={t('upNextShowPharmacyLabel')}
											tooltip={t('upNextShowPharmacyHint')}
											onCheckedChange={(checked) => setUpNextShowPharmacy(checked)}
										/>
									</div>
								)}
							</MapControlSectionCard>

							<MapControlSectionCard
								collapsible
								collapseLabel={sectionCollapseLabel}
								expandLabel={sectionExpandLabel}
								open={settingsPanelPackOpen}
								title={t('sections.packPace')}
								onOpenChange={setSettingsPanelPackOpen}
							>
								<div className="flex flex-col gap-1.5">
									<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">{t('packWeightTitle')}</span>
									<div className={MAP_CONTROL_LABEL_INPUT_GRID}>
										<label
											className="text-xs text-gray-600 dark:text-[var(--text-secondary)]"
											htmlFor="pack-base-weight"
										>
											{t('packBaseWeightLabel')}
										</label>
										<input
											className={cn(MAP_CONTROL_INPUT, 'w-full text-right tabular-nums')}
											id="pack-base-weight"
											min={0}
											step={0.1}
											type="number"
											value={
												packBaseWeightKg === null ? '' : Math.round(kgToDisplay(packBaseWeightKg, units) * 10) / 10
											}
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
										<label
											className="text-xs text-gray-600 dark:text-[var(--text-secondary)]"
											htmlFor="pack-water-consumption"
										>
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
										<label
											className="text-xs text-gray-600 dark:text-[var(--text-secondary)]"
											htmlFor="pack-food-consumption"
										>
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
											{weightUnitLabel(units)}/day
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

							<MapControlSectionCard
								collapsible
								collapseLabel={sectionCollapseLabel}
								expandLabel={sectionExpandLabel}
								open={settingsPanelNotificationsOpen}
								title={t('sections.notificationsSharing')}
								onOpenChange={setSettingsPanelNotificationsOpen}
							>
								{pushAlertsSupported() && (
									<SettingsToggleRow
										checked={pushAlertsEnabled}
										hint={t('pushAlertsHint')}
										label={t('pushAlertsLabel')}
										onCheckedChange={(checked) => void handlePushAlertsToggle(checked)}
									/>
								)}
								<SettingsToggleRow
									checked={shareShortLinks}
									hint={t('shareShortLinksHint')}
									label={t('shareShortLinksLabel')}
									onCheckedChange={(checked) => setShareShortLinks(checked)}
								/>
							</MapControlSectionCard>

							<MapControlSectionCard
								collapsible
								collapseLabel={sectionCollapseLabel}
								expandLabel={sectionExpandLabel}
								open={offlineSectionOpen}
								title={t('sections.offlineMaps')}
								onOpenChange={(open) => setSettingsPanelOfflineOpen(open)}
							>
								<MapControlsTileCachePanel embedded />
							</MapControlSectionCard>

							<MapControlSectionCard
								collapsible
								collapseLabel={sectionCollapseLabel}
								expandLabel={sectionExpandLabel}
								open={settingsPanelImportsOpen}
								title={t('sections.imports')}
								onOpenChange={setSettingsPanelImportsOpen}
							>
								<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
									{t('sections.importsProgressHint')}
								</p>
								<MapControlsImportsPanel embedded />
							</MapControlSectionCard>
						</div>
					</div>
				</div>
			)}
			<SmartTooltip content={isExpanded ? t('preferencesHide') : t('preferencesShow')} position="left">
				<Button
					aria-label={isExpanded ? t('preferencesHide') : t('preferencesShow')}
					variant={isExpanded ? 'controlRoundActive' : 'controlRound'}
					onClick={onToggle}
				>
					<IoSettingsOutline aria-hidden className="h-5 w-5" />
				</Button>
			</SmartTooltip>
		</div>
	);
}
