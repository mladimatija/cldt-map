'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMap, Polyline } from 'react-leaflet';
import {
	IoBedOutline,
	IoCalendarOutline,
	IoDocumentTextOutline,
	IoDownloadOutline,
	IoLocationOutline,
	IoMapOutline,
	IoTrailSignOutline,
	IoTrashOutline,
	IoWatchOutline,
} from 'react-icons/io5';
import SmartTooltip from '@/components/ui/SmartTooltip';
import {
	isKnownType,
	poiDisplayName,
	poiMatchesTagFilter,
	poiPassesReachabilityFilter,
	STAGE_POI_OFFTRAIL_KM,
	type Poi,
} from '@/lib/pois';
import {
	filterOvernightCandidates,
	findStageEndAccommodation,
	type StageEndAccommodation,
} from '@/lib/stage-accommodation';
import { Button, buttonVariants } from '@/components/ui/Button';
import { Radio } from '@/components/ui/Radio';
import { Checkbox } from '@/components/ui/Checkbox';
import { MapControlIconButton } from './MapControlIconButton';
import { MapControlInlineNameForm } from './MapControlInlineNameForm';
import { MapControlSectionCard } from './MapControlSectionCard';
import { SettingsToggleRow } from './SettingsToggleRow';
import type { StagePlanPreset, StagePlanPresetInputs } from '@/lib/store/types';
import { MapControlsTripBriefModal } from './MapControlsTripBriefModal';
import {
	cn,
	formatDistance,
	formatElevation,
	kmToMiles,
	LINKABLE_PHONE_RE,
	milesToKm,
	toDialString,
} from '@/lib/utils';
import { copyTextToClipboard } from '@/lib/share-link-copy';
import {
	buildSafetyContactPlan,
	buildSafetyContactPlanInput,
	DEFAULT_SAFETY_BUFFER_DAYS,
	safetyContactTemplates,
} from '@/lib/safety-contact-plan';
import {
	MAP_CONTROL_FOOTNOTE_LINK,
	MAP_CONTROL_INPUT,
	MAP_CONTROL_LABEL_INPUT_GRID,
	MAP_CONTROL_LINK_BUTTON,
	MAP_CONTROL_PANEL_WIDTH,
	MAP_CONTROL_POPOVER,
} from './map-controls-constants';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { usePopoverFocusTrap, usePackAdjustedPaceKmh } from '@/hooks';
import {
	buildResupplyCadenceLabels,
	collectResupplyTownPoints,
	computePlanResupplyCadence,
	type StageResupplyCadence,
	type StageResupplyStatus,
} from '@/lib/resupply-cadence';
import {
	CARRY_WARN_L,
	computeStagePackScenarios,
	formatPackWeightRange,
	formatVolume,
	formatWeight,
	kgToDisplay,
	weightUnitLabel,
} from '@/lib/pack-weight';
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
import {
	isUsableWaterSource,
	longestDryStretchKm,
	poiWaterReliability,
	WATER_GAP_DANGER_KM,
	WATER_GAP_WARN_KM,
} from '@/lib/water-intelligence';
import {
	buildGpxTrackWithWaypointsXml,
	buildGpxXml,
	buildGpxWaypointXml,
	downloadGpxFile,
	type GpxDocMeta,
	type GpxWaypoint,
} from '@/lib/gpx-export';
import { sacMaxForKmRange, SAC_SCALE_ORDER, type SacScale } from '@/lib/trail-osm-tags';
import {
	hasTrailJunctions,
	junctionColor,
	junctionLabel,
	junctionRowKey,
	type TrailJunction,
} from '@/lib/trail-junctions';
import { dominantSurfaceForKmRange } from '@/lib/surface-section-stats';
import { computeStageSacBreakdown, hasDemandingSacTerrain, type StageSacBreakdown } from '@/lib/stage-sac-stats';
import { findToughestStretches, type ToughestStretch } from '@/lib/terrain-highlights';
import { SAC_BUCKET_SHORT_LABELS, SAC_COLORS } from '@/components/map/trail-route-constants';
import { siteMetadata } from '@/lib/metadata';
import { buildFitCourseBytes, downloadFitFile } from '@/lib/fit-export';
import { exportStripMapPdf, pointsToBounds } from '@/lib/export-utils';
import {
	buildStagePlanIcs,
	downloadIcsFile,
	stageCalendarDate,
	type StageIcalEventInput,
} from '@/lib/stage-ical-export';
import {
	dayOffsetForRestDayAfter,
	dayOffsetForStage,
	normalizeRestDays,
	restDayCountAfter,
	totalTripDays,
} from '@/lib/stage-rest-days';
import { formatShortWeekdayDate } from '@/lib/date-format';
import { TRAIL_OFF_TRAIL_THRESHOLD_M } from '@/lib/config';
import { resolveTrailAnchor, formatAheadHorizon } from '@/lib/poi-ahead-corridor';
import { renderElevationThumbnail } from '@/lib/elevation-thumbnail';

const MAX_STAGES = 200;
const COLLAPSED_STAGE_CHIP_LIMIT = 3;

/** Curated POI types packed into the combined "trip package" GPX: the
 *  safety / resupply markers a hiker needs alongside the line to follow.
 *  Settlements and road-access clutter are deliberately left out; personal
 *  notes and starred state are never read (privacy-first, curated data only). */
const TRIP_PACKAGE_POI_TYPES: ReadonlySet<string> = new Set(['water', 'hut', 'shelter', 'town']);

export function MapControlsStagePlannerPanel(): React.ReactElement {
	const t = useTranslations('stagePlanner');
	const tProgress = useTranslations('progress');
	const tPois = useTranslations('pois');
	const tJunctions = useTranslations('trailJunctions');
	const tWeather = useTranslations('weather');
	const tGpxMeta = useTranslations('gpx');
	const locale = useLocale();

	const stagePlan = useMapStore((s: MapStoreState) => s.stagePlan);
	const setStagePlan = useMapStore((s: MapStoreState) => s.setStagePlan);
	const stagePlanPresets = useMapStore((s: MapStoreState) => s.stagePlanPresets);
	const saveStagePlanPreset = useMapStore((s: MapStoreState) => s.saveStagePlanPreset);
	const deleteStagePlanPreset = useMapStore((s: MapStoreState) => s.deleteStagePlanPreset);
	const clearStagePlan = useMapStore((s: MapStoreState) => s.clearStagePlan);
	const stagePlannerSetupOpen = useMapStore((s: MapStoreState) => s.stagePlannerSetupOpen);
	const setStagePlannerSetupOpen = useMapStore((s: MapStoreState) => s.setStagePlannerSetupOpen);
	const stagePlannerStagesOpen = useMapStore((s: MapStoreState) => s.stagePlannerStagesOpen);
	const setStagePlannerStagesOpen = useMapStore((s: MapStoreState) => s.setStagePlannerStagesOpen);
	const stagePlannerExportOpen = useMapStore((s: MapStoreState) => s.stagePlannerExportOpen);
	const setStagePlannerExportOpen = useMapStore((s: MapStoreState) => s.setStagePlannerExportOpen);
	const walkingPaceKmh = usePackAdjustedPaceKmh();
	const packBaseWeightKg = useMapStore((s: MapStoreState) => s.packBaseWeightKg);
	const waterConsumptionLph = useMapStore((s: MapStoreState) => s.waterConsumptionLph);
	const foodConsumptionKgPerDay = useMapStore((s: MapStoreState) => s.foodConsumptionKgPerDay);
	const packGearList = useMapStore((s: MapStoreState) => s.packGearList);
	const gradeAdjustedEta = useMapStore((s: MapStoreState) => s.gradeAdjustedEta);
	const units = useMapStore((s: MapStoreState) => s.units);
	const poisFile = useMapStore((s: MapStoreState) => s.poisFile);
	const poisLayerEnabled = useMapStore((s: MapStoreState) => s.poisLayerEnabled);
	const enabledPoiTypes = useMapStore((s: MapStoreState) => s.enabledPoiTypes);
	const enabledPoiTags = useMapStore((s: MapStoreState) => s.enabledPoiTags);
	const includeRemotePois = useMapStore((s: MapStoreState) => s.includeRemotePois);
	const requestOpenPoi = useMapStore((s: MapStoreState) => s.requestOpenPoi);
	const rulerRange = useMapStore((s: MapStoreState) => s.rulerRange);
	const aheadHorizonKm = useMapStore((s: MapStoreState) => s.aheadHorizonKm);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);
	const trailOsmTagsFile = useMapStore((s: MapStoreState) => s.trailOsmTagsFile);
	const trailJunctionsFile = useMapStore((s: MapStoreState) => s.trailJunctionsFile);
	const requestPoiListAhead = useMapStore((s: MapStoreState) => s.requestPoiListAhead);
	const openHelpToPlanning = useMapStore((s: MapStoreState) => s.openHelpToPlanning);
	const sosCard = useMapStore((s: MapStoreState) => s.sosCard);

	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);
	const trailMetadata = useStore((s: StoreState) => s.trailMetadata);
	const closestPoint = useStore((s: StoreState) => s.closestPoint);
	const direction = useStore((s: StoreState) => s.direction);
	const isNobo = direction === 'NOBO';

	const map = useMap();
	const popoverRef = usePopoverFocusTrap(true);

	const isImperial = units === 'imperial';

	const trailAnchor = useMemo(
		() => resolveTrailAnchor(closestPoint, rulerRange, TRAIL_OFF_TRAIL_THRESHOLD_M),
		[closestPoint, rulerRange],
	);

	const aheadHorizonLabel = useMemo(
		() => formatAheadHorizon(aheadHorizonKm, units, distancePrecision),
		[aheadHorizonKm, units, distancePrecision],
	);

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
	const [stagePresetName, setStagePresetName] = useState('');
	const [isSavingStagePreset, setIsSavingStagePreset] = useState(false);
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
	/** Session-only alert buffer (days after the planned finish) for the
	 *  safety-contact handoff. Intentionally not persisted to the store. */
	const [safetyBuffer, setSafetyBuffer] = useState(DEFAULT_SAFETY_BUFFER_DAYS);
	const [safetyCopied, setSafetyCopied] = useState(false);
	const safetyCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [canShareSafety] = useState<boolean>(
		() => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
	);
	const [pdfProgress, setPdfProgress] = useState<{ current: number; total: number } | null>(null);
	const pdfAbortRef = useRef<AbortController | null>(null);
	/** POI ids selected for per-stage GPX export, keyed by stage index. */
	const [selectedStagePoiIdsByStage, setSelectedStagePoiIdsByStage] = useState<
		ReadonlyMap<number, ReadonlySet<string>>
	>(() => new Map());

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

	/** Per-stage calendar date label (e.g. "Mon 17 Jun"), rest days included, or
	 *  [] when no trip start date is set. */
	const stageDateLabels = useMemo((): string[] => {
		if (!stagePlan?.startDate) return [];
		const start = stagePlan.startDate;
		return stagePlan.stages.map((_, i) =>
			formatShortWeekdayDate(stageCalendarDate(start, dayOffsetForStage(i, stagePlan.restDays)), locale),
		);
	}, [stagePlan, locale]);

	const restDayCount = stagePlan?.restDays?.length ?? 0;

	/** Append one rest day after stage `index`; keeps the anchor list sorted. */
	const addRestDayAfter = (index: number): void => {
		if (!stagePlan) return;
		setStagePlan({ ...stagePlan, restDays: normalizeRestDays([...(stagePlan.restDays ?? []), index]) });
	};

	/** Remove a single rest day anchored after stage `index`. */
	const removeRestDayAfter = (index: number): void => {
		if (!stagePlan?.restDays?.length) return;
		const at = stagePlan.restDays.indexOf(index);
		if (at === -1) return;
		const next = stagePlan.restDays.filter((_, i) => i !== at);
		setStagePlan({ ...stagePlan, restDays: next.length > 0 ? next : undefined });
	};

	const currentPlannerInputs = (): StagePlanPresetInputs => ({
		startKm,
		endKm,
		mode,
		kmPerDayKm,
		stageCount,
		balanceByEta,
		maxHoursPerDay,
		startDate: tripStartDate || undefined,
	});

	const runGenerate = (inputs: StagePlanPresetInputs): void => {
		if (!enhancedTrailPoints?.length) return;
		const safeKmPerDay = Math.max(0.1, inputs.kmPerDayKm);
		const safeStageCount = Math.min(MAX_STAGES, Math.max(1, inputs.stageCount));
		const requestedCount =
			inputs.mode === 'stages'
				? safeStageCount
				: Math.min(MAX_STAGES, Math.max(1, Math.ceil((inputs.endKm - inputs.startKm) / safeKmPerDay)));
		const minCount = computeMinStagesForCap(
			enhancedTrailPoints,
			inputs.startKm,
			inputs.endKm,
			walkingPaceKmh,
			gradeAdjustedEta,
			inputs.maxHoursPerDay,
		);
		const finalCount = Math.min(MAX_STAGES, Math.max(requestedCount, minCount));
		setAutoBumpNotice(finalCount > requestedCount ? { requested: requestedCount, actual: finalCount } : null);
		const plan = inputs.balanceByEta
			? splitByEta(enhancedTrailPoints, inputs.startKm, inputs.endKm, walkingPaceKmh, gradeAdjustedEta, finalCount)
			: splitByDistance(inputs.startKm, inputs.endKm, (inputs.endKm - inputs.startKm) / finalCount);
		setStagePlan({ ...plan, startDate: inputs.startDate || undefined });
		setActiveStageIndex(0);
		setSelectedStagePoiIdsByStage(new Map());
		setConfirmReset(false);
		setStagePlannerSetupOpen(false);
		setStagePlannerStagesOpen(true);
	};

	const handleGenerate = (): void => runGenerate(currentPlannerInputs());

	const applyStagePreset = (preset: StagePlanPreset): void => {
		const inp = preset.inputs;
		setStartKm(inp.startKm);
		setEndKm(inp.endKm);
		setMode(inp.mode);
		setKmPerDayKm(inp.kmPerDayKm);
		setStageCount(inp.stageCount);
		setBalanceByEta(inp.balanceByEta);
		setMaxHoursPerDay(inp.maxHoursPerDay);
		setTripStartDate(inp.startDate ?? '');
		// Generate from the preset inputs directly (state setters are async).
		runGenerate(inp);
	};

	const handleSaveStagePreset = (): void => {
		const id = saveStagePlanPreset(stagePresetName, currentPlannerInputs());
		if (id) {
			setStagePresetName('');
			setIsSavingStagePreset(false);
		}
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

	/** Document-level metadata for a stage GPX export: stage stats with the same
	 *  isNobo ascent/descent swap handleFitExport applies, plus SAC/surface
	 *  difficulty over the stage's SOBO km window. SAC/surface are added only when
	 *  the OSM tag dataset is loaded, so the export stays valid without it. */
	const buildStageMeta = (
		stage: { startKm: number; endKm: number },
		stats: { distanceM: number; gainM: number; lossM: number; etaSec: number },
		index: number,
	): GpxDocMeta => {
		const ascentM = isNobo ? stats.lossM : stats.gainM;
		const descentM = isNobo ? stats.gainM : stats.lossM;
		const parts: string[] = [
			tGpxMeta('descDistance', { value: formatDistance(stats.distanceM / 1000, units, distancePrecision) }),
			tGpxMeta('descAscent', { value: formatElevation(ascentM, units) }),
			tGpxMeta('descDescent', { value: formatElevation(descentM, units) }),
			tGpxMeta('descHikingTime', { value: formatEta(stats.etaSec) }),
		];
		const runs = trailOsmTagsFile?.runs;
		if (runs?.length) {
			// stage.startKm/endKm are already SOBO km - the OSM runs share that frame.
			const sac = sacMaxForKmRange(runs, stage.startKm, stage.endKm);
			if (sac) parts.push(tGpxMeta('descSacMax', { value: SAC_BUCKET_SHORT_LABELS[sac] }));
			const surface = dominantSurfaceForKmRange(runs, stage.startKm, stage.endKm);
			if (surface) parts.push(tGpxMeta('descSurface', { value: tGpxMeta(`surface.${surface}`) }));
		}
		const statsLine = parts.join(' · ');
		return {
			name: tGpxMeta('stageName', { index: index + 1 }),
			desc: statsLine,
			trackDesc: statsLine,
			time: new Date().toISOString(),
			link: siteMetadata.url,
		};
	};

	const handleGpxExport = (): void => {
		if (activeStageIndex === null || !stagePlan || !enhancedTrailPoints?.length) return;
		const stage = stagePlan.stages[activeStageIndex];
		const startIdx = findNearestPointIndex(enhancedTrailPoints, stage.startKm * 1000);
		const endIdx = findNearestPointIndex(enhancedTrailPoints, stage.endKm * 1000);
		let pts = enhancedTrailPoints.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);
		if (isNobo) pts = [...pts].reverse();
		const stats = stageStats[activeStageIndex];
		const meta = stats ? buildStageMeta(stage, stats, activeStageIndex) : undefined;
		const gpx = buildGpxXml(
			pts.map((p) => ({ lat: p.lat, lng: p.lng, elevation: p.elevation })),
			`CLDT Stage ${activeStageIndex + 1}`,
			meta,
		);
		downloadGpxFile(gpx, `cldt-stage-${activeStageIndex + 1}.gpx`);
	};

	const handleFitExport = async (): Promise<void> => {
		if (activeStageIndex === null || !stagePlan || !enhancedTrailPoints?.length) return;
		const stage = stagePlan.stages[activeStageIndex];
		const startIdx = findNearestPointIndex(enhancedTrailPoints, stage.startKm * 1000);
		const endIdx = findNearestPointIndex(enhancedTrailPoints, stage.endKm * 1000);
		let pts = enhancedTrailPoints.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);
		if (isNobo) pts = [...pts].reverse();
		if (pts.length < 2) return;
		const stats = stageStats[activeStageIndex];
		const fitBytes = await buildFitCourseBytes({
			points: pts.map((p) => ({ lat: p.lat, lng: p.lng, elevation: p.elevation })),
			courseName: `CLDT Stage ${activeStageIndex + 1}`,
			totalAscentM: stats ? (isNobo ? stats.lossM : stats.gainM) : undefined,
			totalDescentM: stats ? (isNobo ? stats.gainM : stats.lossM) : undefined,
		});
		downloadFitFile(fitBytes, `cldt-stage-${activeStageIndex + 1}.fit`);
	};

	const handleIcalExport = (): void => {
		if (!stagePlan?.startDate || stagePlan.stages.length === 0 || stageStats.length === 0) return;
		const events = stagePlan.stages.map((stage, index) => {
			const stats = stageStats[index];
			const startDisplay = toDisplay(stage.startKm).toFixed(1);
			const endDisplay = toDisplay(stage.endKm).toFixed(1);
			const distDisplay = toDisplay(stats.distanceM / 1000).toFixed(1);
			const gainM = isNobo ? stats.lossM : stats.gainM;
			const lossM = isNobo ? stats.gainM : stats.lossM;
			const date = stageCalendarDate(stagePlan.startDate!, dayOffsetForStage(index, stagePlan.restDays));
			return {
				date,
				summary: t('icalEventSummary', {
					index: index + 1,
					start: startDisplay,
					end: endDisplay,
					unit: distanceUnitLabel,
				}),
				description: [
					t('icalKmRange', { start: startDisplay, end: endDisplay, unit: distanceUnitLabel }),
					t('icalDistance', { value: `${distDisplay} ${distanceUnitLabel}` }),
					t('icalGain', { value: formatElevation(gainM, units) }),
					t('icalLoss', { value: formatElevation(lossM, units) }),
					t('icalEta', { value: formatEta(stats.etaSec) }),
					t('icalDirection', { direction: direction === 'NOBO' ? 'NOBO' : 'SOBO' }),
				].join('\n'),
			};
		});
		// One all-day "Rest day" event per zero day, dated like the stages it sits
		// between so an imported calendar reads start -> rest -> resume in order.
		const restEvents: StageIcalEventInput[] = [];
		const occurrenceByStage = new Map<number, number>();
		for (const anchor of stagePlan.restDays ?? []) {
			const occurrence = occurrenceByStage.get(anchor) ?? 0;
			occurrenceByStage.set(anchor, occurrence + 1);
			restEvents.push({
				date: stageCalendarDate(stagePlan.startDate, dayOffsetForRestDayAfter(anchor, occurrence, stagePlan.restDays)),
				summary: t('icalRestDaySummary'),
				description: t('icalRestDayDescription', { stage: anchor + 1 }),
			});
		}
		const ics = buildStagePlanIcs([...events, ...restEvents], t('icalCalendarName'));
		downloadIcsFile(ics, `cldt-stages-${stagePlan.startDate}.ics`);
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
		setSelectedStagePoiIdsByStage(new Map());
		setConfirmReset(false);
		setStagePlannerSetupOpen(true);
		setStagePlannerStagesOpen(false);
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

	/** Elevation-profile thumbnail (PNG data URL) for the expanded stage only.
	 *  renderElevationThumbnail slices enhancedTrailPoints to the stage's km
	 *  window and reverses for NOBO, so the profile reads left-to-right in the
	 *  walking direction - same call the trip brief uses per day. Computed only
	 *  for the active stage (a canvas draw), so collapsed stages never render one. */
	const activeStageElevationThumb = useMemo((): string | null => {
		if (activeStageIndex === null || !stagePlan || !enhancedTrailPoints?.length) return null;
		const stage = stagePlan.stages[activeStageIndex];
		if (!stage) return null;
		return renderElevationThumbnail(enhancedTrailPoints, stage.startKm, stage.endKm, isNobo);
	}, [activeStageIndex, stagePlan, enhancedTrailPoints, isNobo]);

	/** Top grade-based crux stretches for the expanded stage only (scanning the
	 *  enhanced points per stage is O(n), so keep it to the open one - like the
	 *  elevation thumbnail). Grade covers the whole trail; each stretch is
	 *  annotated with the SAC class only where the OSM data tags that sub-range. */
	const activeStageToughestStretches = useMemo((): ToughestStretch[] => {
		if (activeStageIndex === null || !stagePlan || !enhancedTrailPoints?.length) return [];
		const stage = stagePlan.stages[activeStageIndex];
		if (!stage) return [];
		return findToughestStretches(enhancedTrailPoints, stage.startKm, stage.endKm, trailOsmTagsFile?.runs ?? [], 3);
	}, [activeStageIndex, stagePlan, enhancedTrailPoints, trailOsmTagsFile]);

	const distanceUnitLabel = isImperial ? 'mi' : 'km';
	const valueUnitLabel = mode === 'stages' ? t('modeStages') : `${distanceUnitLabel}/day`;
	const showMaxHoursRow = balanceByEta || mode === 'kmPerDay';
	const sectionCollapseLabel = tProgress('collapseSection');
	const sectionExpandLabel = tProgress('expandSection');

	const tripTotalDistance = useMemo((): string | null => {
		if (!stagePlan || stageStats.length === 0) return null;
		const totalKm = stageStats.reduce((sum, stats) => sum + stats.distanceM / 1000, 0);
		return formatDistance(totalKm, units, distancePrecision);
	}, [stagePlan, stageStats, units, distancePrecision]);

	/** POIs that the renderer would also draw - same enabled-types and master
	 *  toggle filter so the planner view never lists POIs the user has hidden. */
	const visiblePois = useMemo((): Poi[] => {
		if (!poisFile?.pois?.length || !poisLayerEnabled) return [];
		return poisFile.pois.filter(
			(p) =>
				isKnownType(p.type) &&
				enabledPoiTypes.has(p.type) &&
				poiMatchesTagFilter(p, enabledPoiTags) &&
				poiPassesReachabilityFilter(p, includeRemotePois) &&
				p.distanceFromTrailKm <= STAGE_POI_OFFTRAIL_KM,
		);
	}, [poisFile, poisLayerEnabled, enabledPoiTypes, enabledPoiTags, includeRemotePois]);

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

	/** Marked-trail junctions (OSM route relations branching off the CLDT) whose
	 *  SOBO km falls inside each stage's [startKm, endKm] window. Empty until
	 *  junction data is enriched, so the whole section stays hidden while the
	 *  feature is dormant. */
	const junctionsByStage = useMemo((): TrailJunction[][] => {
		if (!stagePlan || !hasTrailJunctions(trailJunctionsFile)) return [];
		return stagePlan.stages.map((stage) => {
			const lo = Math.min(stage.startKm, stage.endKm);
			const hi = Math.max(stage.startKm, stage.endKm);
			// junctions is already globally sorted ascending by trailKm in normalize();
			// filter() preserves that order, so no per-stage re-sort is needed (the
			// isNobo reversal at render handles walking direction).
			return trailJunctionsFile.junctions.filter((j) => j.trailKm >= lo && j.trailKm <= hi);
		});
	}, [stagePlan, trailJunctionsFile]);
	const totalStageJunctions = useMemo(
		() => junctionsByStage.reduce((n, list) => n + list.length, 0),
		[junctionsByStage],
	);
	const [junctionsSectionOpen, setJunctionsSectionOpen] = useState(false);

	/** Trail-km positions of water sources a hiker can plan around (explicitly
	 *  non-potable excluded). Deliberately ignores the layer / type visibility
	 *  filters: hiding water markers on the map must not hide a safety stat.
	 *  The enrichment pipeline caps water at 1 km off trail, so no extra
	 *  distance filter is needed here. */
	const waterSourceKms = useMemo((): number[] => {
		if (!poisFile?.pois?.length) return [];
		return poisFile.pois.filter((p) => p.type === 'water' && isUsableWaterSource(p.water)).map((p) => p.trailKm);
	}, [poisFile]);

	/** Per-stage longest stretch (km, SOBO-keyed but direction-agnostic)
	 *  without passing a usable water source. Empty when the dataset has no
	 *  water rows at all (pre-water-layer datasets), so the UI can hide the
	 *  stat instead of claiming every stage is bone dry. */
	const waterGapByStage = useMemo((): number[] => {
		if (!stagePlan || waterSourceKms.length === 0) return [];
		return stagePlan.stages.map((s) => longestDryStretchKm(s.startKm, s.endKm, waterSourceKms));
	}, [stagePlan, waterSourceKms]);

	/** Nearest place to sleep at each stage boundary (hut / shelter / town /
	 *  settlement). Like the dry-stretch stat, it reads the full POI dataset
	 *  rather than the layer-visibility-filtered subset, so hiding hut markers on
	 *  the map never hides the "where do I sleep tonight?" answer. */
	const overnightPois = useMemo((): Poi[] => filterOvernightCandidates(poisFile?.pois ?? []), [poisFile]);
	const accommodationByStage = useMemo((): (StageEndAccommodation | null)[] => {
		if (!stagePlan) return [];
		return stagePlan.stages.map((s) => findStageEndAccommodation(s.endKm, overnightPois));
	}, [stagePlan, overnightPois]);

	/** Per-stage SAC hiking-scale breakdown over the stage's SOBO km window (the
	 *  OSM runs share that frame). Empty until the OSM tag dataset is lazy-loaded,
	 *  so the terrain chip and SAC mix stay hidden while the data is absent. */
	const stageSacByStage = useMemo((): (StageSacBreakdown | null)[] => {
		const runs = trailOsmTagsFile?.runs;
		if (!stagePlan || !runs?.length) return [];
		return stagePlan.stages.map((s) => computeStageSacBreakdown(runs, s.startKm, s.endKm));
	}, [stagePlan, trailOsmTagsFile]);

	/** Localized, on-device, account-free itinerary a hiker hands to a trusted
	 *  contact so they can pass it to rescuers if the hiker never checks in.
	 *  Nothing is uploaded or tracked. Null until the plan has at least one stage. */
	const safetyContactPlan = useMemo(() => {
		if (!stagePlan || stagePlan.stages.length === 0) return null;
		const templates = safetyContactTemplates(t);
		return buildSafetyContactPlan(
			buildSafetyContactPlanInput({ stagePlan, overnightPois, templates, locale, bufferDays: safetyBuffer }),
		);
	}, [stagePlan, overnightPois, locale, t, safetyBuffer]);

	const safetyContactBody = safetyContactPlan?.body ?? '';

	// Gate the sms: link exactly like the emergency panel: LINKABLE_PHONE_RE on the
	// unsanitized saved contact phone, then a +/digits dial string so no stray
	// character can inject extra sms: URI parameters. No saved phone -> no Text button.
	const safetyContactPhone = sosCard.emergencyContactPhone?.trim();
	const safetySmsTo =
		safetyContactPhone && LINKABLE_PHONE_RE.test(safetyContactPhone) ? toDialString(safetyContactPhone) : '';
	const safetySmsHref =
		safetySmsTo && safetyContactBody ? `sms:${safetySmsTo}?body=${encodeURIComponent(safetyContactBody)}` : undefined;

	useEffect(
		() => () => {
			if (safetyCopyTimerRef.current !== null) clearTimeout(safetyCopyTimerRef.current);
		},
		[],
	);

	const handleCopySafetyContact = (): void => {
		if (!safetyContactBody) return;
		void copyTextToClipboard(safetyContactBody).then((ok) => {
			if (!ok) return;
			setSafetyCopied(true);
			if (safetyCopyTimerRef.current !== null) clearTimeout(safetyCopyTimerRef.current);
			safetyCopyTimerRef.current = setTimeout(() => {
				setSafetyCopied(false);
				safetyCopyTimerRef.current = null;
			}, 1500);
		});
	};

	const handleShareSafetyContact = (): void => {
		if (!safetyContactBody || !canShareSafety) return;
		void navigator.share({ text: safetyContactBody }).catch(() => {
			/* user dismissed the share sheet or share failed - no-op */
		});
	};

	/** Full-plan food resupply cadence from enrichment data (ignores POI layer visibility). */
	const planResupplyCadence = useMemo(() => {
		if (!stagePlan || !poisFile?.pois?.length) return null;
		const resupplyPoints = collectResupplyTownPoints(poisFile.pois);
		if (resupplyPoints.length === 0) return null;
		return computePlanResupplyCadence(stagePlan.stages, poisFile.pois, resupplyPoints);
	}, [stagePlan, poisFile]);

	const poiById = useMemo((): Map<string, Poi> => {
		const map = new Map<string, Poi>();
		for (const poi of poisFile?.pois ?? []) map.set(poi.id, poi);
		return map;
	}, [poisFile]);

	const resupplyTownName = useCallback(
		(id: string | undefined): string | undefined => {
			if (!id) return undefined;
			const poi = poiById.get(id);
			return poi ? poiDisplayName(poi, locale) : undefined;
		},
		[poiById, locale],
	);

	const resupplyStatusLabel = useCallback(
		(status: StageResupplyStatus): string | undefined => {
			if (status === 'yes') return t('stageResupplyYes');
			if (status === 'partial') return t('stageResupplyPartial');
			if (status === 'no') return t('stageResupplyNo');
			return undefined;
		},
		[t],
	);

	const stageResupplyDetailLines = useCallback(
		(cadence: StageResupplyCadence | undefined): string[] => {
			if (!cadence) return [];
			const labels = buildResupplyCadenceLabels(cadence, {
				formatKm: (km) => formatDistance(km, units, distancePrecision),
				resolveTownName: resupplyTownName,
				consumableKg: packGearList?.consumableKg ?? 0,
				foodConsumptionKgPerDay,
				rateLabel: `${Math.round(kgToDisplay(foodConsumptionKgPerDay, units) * 10) / 10} ${weightUnitLabel(units)}/day`,
				entering: (v) => t('stageFoodEntering', v),
				carry: (v) => t('stageFoodCarry', v),
				foodPack: (v) => t('stageFoodPackDays', v),
			});
			return [labels.entering, labels.carry, labels.foodPack].filter((l): l is string => !!l);
		},
		[t, units, distancePrecision, resupplyTownName, packGearList, foodConsumptionKgPerDay],
	);

	const tripNextGroceryTown = useMemo((): string | null => {
		if (!planResupplyCadence?.firstGrocery || planResupplyCadence.kmToFirstGrocery === null) return null;
		return resupplyTownName(planResupplyCadence.firstGrocery.id) ?? null;
	}, [planResupplyCadence, resupplyTownName]);

	/** Per-stage base vs loaded pack scenarios across the longest dry stretch. */
	const packScenariosByStage = useMemo(() => {
		if (packBaseWeightKg === null || waterGapByStage.length === 0) return [];
		return waterGapByStage.map((gapKm) =>
			computeStagePackScenarios(packBaseWeightKg, gapKm, walkingPaceKmh, waterConsumptionLph),
		);
	}, [packBaseWeightKg, waterGapByStage, walkingPaceKmh, waterConsumptionLph]);

	/** Shared POI -> GPX waypoint mapping for every stage export (the all-stages
	 *  POI list and the per-stage trip package). Builds the common
	 *  lat/lng/name/type/elevation fields so waypoint formatting stays identical
	 *  across exports; callers pass the per-export description/url. */
	const poiToGpxWaypoint = useCallback(
		(poi: Poi, extra: { description?: string; url?: string }): GpxWaypoint => ({
			lat: poi.lat,
			lng: poi.lng,
			name: poiDisplayName(poi, locale),
			type: tPois(`type.${poi.type}`, { default: poi.type }),
			elevation: typeof poi.elevationM === 'number' ? poi.elevationM : undefined,
			description: extra.description,
			url: extra.url,
		}),
		[locale, tPois],
	);

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
				out.push(
					poiToGpxWaypoint(poi, {
						description: poi.note_en || poi.note_hr || undefined,
						url: poi.url || undefined,
					}),
				);
			}
		}
		return out;
	}, [stagePlan, poisByStage, poiToGpxWaypoint]);

	const handleAllStagesPoiExport = (): void => {
		if (allStagesWaypoints.length === 0) return;
		const xml = buildGpxWaypointXml(allStagesWaypoints, t('title'));
		downloadGpxFile(xml, 'cldt-stages-pois.gpx');
	};

	/** Curated safety / resupply POIs (water, huts, shelters, towns) whose SOBO km
	 *  falls inside the active stage window, mapped to the GPX waypoint shape for
	 *  the combined trip-package export. Reads the curated dataset directly - not
	 *  the layer-visibility subset, personal notes, or starred state - so the
	 *  package stays privacy-first and honest even when those layers are hidden.
	 *  Water carries its reliability class in the description; the list reads in
	 *  walking order (NOBO reverses it) to match the track. */
	const tripPackageWaypoints = useMemo((): GpxWaypoint[] => {
		if (activeStageIndex === null || !stagePlan || !poisFile?.pois?.length) return [];
		const stage = stagePlan.stages[activeStageIndex];
		if (!stage) return [];
		const lo = Math.min(stage.startKm, stage.endKm);
		const hi = Math.max(stage.startKm, stage.endKm);
		const inStage = poisFile.pois
			.filter(
				(p) =>
					TRIP_PACKAGE_POI_TYPES.has(p.type) &&
					p.trailKm >= lo &&
					p.trailKm <= hi &&
					p.distanceFromTrailKm <= STAGE_POI_OFFTRAIL_KM,
			)
			.sort((a, b) => a.trailKm - b.trailKm);
		const ordered = isNobo ? [...inStage].reverse() : inStage;
		return ordered.map((poi) => {
			const reliability = poiWaterReliability(poi);
			return poiToGpxWaypoint(poi, {
				description: reliability ? tPois(`water.${reliability}`) : undefined,
			});
		});
	}, [activeStageIndex, stagePlan, poisFile, isNobo, tPois, poiToGpxWaypoint]);

	/** Combined "trip package": the active stage's track slice (same NOBO-aware
	 *  slice the plain stage GPX uses) plus the curated safety waypoints above,
	 *  as one well-formed GPX 1.1 file for offline GPS apps. */
	const handleTripPackageExport = (): void => {
		if (activeStageIndex === null || !stagePlan || !enhancedTrailPoints?.length) return;
		const stage = stagePlan.stages[activeStageIndex];
		const startIdx = findNearestPointIndex(enhancedTrailPoints, stage.startKm * 1000);
		const endIdx = findNearestPointIndex(enhancedTrailPoints, stage.endKm * 1000);
		let pts = enhancedTrailPoints.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);
		if (isNobo) pts = [...pts].reverse();
		if (pts.length < 2) return;
		const stats = stageStats[activeStageIndex];
		const meta = stats ? buildStageMeta(stage, stats, activeStageIndex) : undefined;
		const gpx = buildGpxTrackWithWaypointsXml(
			pts.map((p) => ({ lat: p.lat, lng: p.lng, elevation: p.elevation })),
			tripPackageWaypoints,
			`CLDT Stage ${activeStageIndex + 1}`,
			meta,
		);
		downloadGpxFile(gpx, `cldt-stage-${activeStageIndex + 1}-trip-package.gpx`);
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
				className={cn(
					'z-controls-popover fixed top-2 right-16 flex max-h-[calc(100dvh-4rem)] flex-col gap-2 overflow-hidden',
					MAP_CONTROL_PANEL_WIDTH,
					MAP_CONTROL_POPOVER,
				)}
				ref={popoverRef}
				role="dialog"
				onContextMenu={(e) => e.preventDefault()}
				onMouseDown={(e) => e.stopPropagation()}
				onTouchStart={(e) => e.stopPropagation()}
			>
				<h3
					className="shrink-0 text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]"
					id="stage-planner-title"
				>
					{t('title')}
				</h3>

				<div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
					<div className="flex flex-col gap-2">
						{stagePlan && tripTotalDistance && (
							<div className="sticky top-0 z-[1] -mx-1 mb-1 border-b border-gray-200 bg-white px-1 pb-2 dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)]">
								<p className="m-0 text-sm font-semibold text-gray-900 dark:text-white">
									{t('tripSummaryLine', { count: stagePlan.stages.length, distance: tripTotalDistance })}
								</p>
								{restDayCount > 0 && (
									<p className="m-0 mt-0.5 text-[0.6875rem] text-gray-600 dark:text-[var(--text-secondary)]">
										<span aria-hidden>🛏️</span>{' '}
										{t('tripRestDays', {
											count: restDayCount,
											total: totalTripDays(stagePlan.stages.length, stagePlan.restDays),
										})}
									</p>
								)}
								{planResupplyCadence && (
									<p className="m-0 mt-0.5 text-[0.6875rem] text-gray-600 dark:text-[var(--text-secondary)]">
										<span aria-hidden>🛒</span>{' '}
										{t('tripFoodGap', {
											distance: formatDistance(planResupplyCadence.maxFoodGapKm, units, distancePrecision),
										})}
									</p>
								)}
								{tripNextGroceryTown &&
									planResupplyCadence?.kmToFirstGrocery !== null &&
									planResupplyCadence?.kmToFirstGrocery !== undefined && (
										<p className="m-0 text-[0.6875rem] text-gray-600 dark:text-[var(--text-secondary)]">
											{t('tripNextGrocery', {
												town: tripNextGroceryTown,
												distance: formatDistance(planResupplyCadence.kmToFirstGrocery, units, distancePrecision),
											})}
										</p>
									)}
							</div>
						)}

						<MapControlSectionCard
							collapsible
							collapseLabel={sectionCollapseLabel}
							expandLabel={sectionExpandLabel}
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
									<Radio
										checked={mode === 'stages'}
										name="stage-mode"
										value="stages"
										onChange={() => setMode('stages')}
									/>
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

							{trailAnchor && (
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

						{!stagePlan && (
							<p className="mb-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('noStages')}</p>
						)}

						{stagePlan && (
							<MapControlSectionCard
								collapsible
								collapseLabel={sectionCollapseLabel}
								expandLabel={sectionExpandLabel}
								open={stagePlannerStagesOpen}
								title={t('sections.stages')}
								onOpenChange={setStagePlannerStagesOpen}
							>
								<div className="divide-y divide-gray-100 rounded border border-gray-100 dark:divide-[var(--border-color)] dark:border-[var(--border-color)]">
									{stagePlan.stages.map((stage, i) => {
										const stats = stageStats[i];
										const poiCount = poisByStage[i]?.length ?? 0;
										const stageCadence = planResupplyCadence?.stages[i];
										const resupplyStatus = stageCadence?.status ?? null;
										const isActive = i === activeStageIndex;
										const stagePois = isNobo ? [...(poisByStage[i] ?? [])].reverse() : (poisByStage[i] ?? []);
										const stageSelectedPoiIds = selectedStagePoiIdsByStage.get(i) ?? new Set<string>();
										return (
											<React.Fragment key={`${stage.startKm}-${stage.endKm}`}>
												<div
													className={cn(
														'border-l-4',
														isActive ? 'border-l-cldt-blue bg-cldt-light-blue/40' : 'border-l-transparent',
													)}
												>
													<button
														aria-expanded={isActive}
														className={cn(
															'focus-visible:ring-cldt-green flex w-full flex-col gap-0.5 px-2 py-1.5 text-left text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
															isActive
																? 'text-gray-900 dark:text-white'
																: 'hover:bg-gray-50 dark:hover:bg-[var(--bg-hover)]',
														)}
														type="button"
														onClick={() => handleStageClick(i)}
													>
														<span className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
															<span className="min-w-4 font-medium">{i + 1}</span>
															<span className="whitespace-nowrap text-gray-500 dark:text-[var(--text-secondary)]">
																{toDisplay(stage.startKm).toFixed(0)}-{toDisplay(stage.endKm).toFixed(0)}{' '}
																{distanceUnitLabel}
															</span>
															{stageDateLabels[i] && (
																<span className="shrink-0 whitespace-nowrap text-gray-400 dark:text-[var(--text-secondary)]">
																	{stageDateLabels[i]}
																</span>
															)}
															{stats && (
																<>
																	<span className="text-cldt-green shrink-0">
																		↑{formatElevation(isNobo ? stats.lossM : stats.gainM, units)}
																	</span>
																	<span className="text-cldt-red shrink-0">
																		↓{formatElevation(isNobo ? stats.gainM : stats.lossM, units)}
																	</span>
																	<span className="shrink-0 text-gray-500 tabular-nums dark:text-[var(--text-secondary)]">
																		{formatEta(stats.etaSec)}
																	</span>
																</>
															)}
														</span>
														{(() => {
															const chips: React.ReactElement[] = [];
															const sacBreakdown = stageSacByStage[i];
															if (hasDemandingSacTerrain(sacBreakdown) && sacBreakdown?.hardestClass) {
																const hardestClass = sacBreakdown.hardestClass;
																const shortLabel = SAC_BUCKET_SHORT_LABELS[hardestClass];
																const kmDisplay = toDisplay(sacBreakdown.hardestKm);
																const kmCompact = kmDisplay < 10 ? kmDisplay.toFixed(1) : kmDisplay.toFixed(0);
																const terrainAria = t('stageTerrainChip', {
																	class: shortLabel,
																	distance: formatDistance(sacBreakdown.hardestKm, units, distancePrecision),
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
																		{shortLabel} {kmCompact} {distanceUnitLabel}
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
															const sleepAcc = accommodationByStage[i];
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
															if (waterGapByStage[i] !== undefined && waterGapByStage[i] >= WATER_GAP_WARN_KM) {
																chips.push(
																	<span
																		aria-label={t('stageWaterGap', {
																			distance: `${toDisplay(waterGapByStage[i]).toFixed(0)} ${distanceUnitLabel}`,
																		})}
																		className={cn(
																			'shrink-0 rounded-full px-1.5 py-0 text-[0.625rem] font-medium tabular-nums',
																			waterGapByStage[i] >= WATER_GAP_DANGER_KM
																				? 'bg-cldt-red/10 text-cldt-red'
																				: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
																		)}
																		key="water"
																		title={t('stageWaterGap', {
																			distance: `${toDisplay(waterGapByStage[i]).toFixed(0)} ${distanceUnitLabel}`,
																		})}
																	>
																		<span aria-hidden>💧</span>
																		{toDisplay(waterGapByStage[i]).toFixed(0)}
																	</span>,
																);
															}
															if (packScenariosByStage[i] !== undefined) {
																chips.push(
																	<span
																		aria-label={
																			packScenariosByStage[i].carryLiters > 0
																				? t('stagePackTooltipLoaded', {
																						base: formatWeight(packScenariosByStage[i].baseKg, units),
																						loaded: formatWeight(packScenariosByStage[i].loadedKg, units),
																						volume: formatVolume(packScenariosByStage[i].carryLiters, units),
																					})
																				: t('stagePackTooltipBase', {
																						base: formatWeight(packScenariosByStage[i].baseKg, units),
																					})
																		}
																		className={cn(
																			'shrink-0 rounded-full px-1.5 py-0 text-[0.625rem] font-medium tabular-nums',
																			packScenariosByStage[i].carryLiters >= CARRY_WARN_L
																				? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
																				: 'bg-gray-500/10 text-gray-600 dark:text-[var(--text-primary)]',
																		)}
																		key="pack"
																		title={
																			packScenariosByStage[i].carryLiters > 0
																				? t('stagePackTooltipLoaded', {
																						base: formatWeight(packScenariosByStage[i].baseKg, units),
																						loaded: formatWeight(packScenariosByStage[i].loadedKg, units),
																						volume: formatVolume(packScenariosByStage[i].carryLiters, units),
																					})
																				: t('stagePackTooltipBase', {
																						base: formatWeight(packScenariosByStage[i].baseKg, units),
																					})
																		}
																	>
																		<span aria-hidden>🎒</span>
																		{formatPackWeightRange(
																			packScenariosByStage[i].baseKg,
																			packScenariosByStage[i].loadedKg,
																			units,
																		)}
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
															if (stageForecasts[i]) {
																chips.push(
																	<span
																		aria-label={t('forecastTitle', {
																			condition: tWeather(weatherCodeToKey(stageForecasts[i].weatherCode)),
																			max: formatCompactTemp(stageForecasts[i].tMaxC, units),
																			min: formatCompactTemp(stageForecasts[i].tMinC, units),
																			precip: stageForecasts[i].precipProbPct,
																		})}
																		className="shrink-0 text-gray-600 tabular-nums dark:text-[var(--text-primary)]"
																		key="forecast"
																		title={t('forecastTitle', {
																			condition: tWeather(weatherCodeToKey(stageForecasts[i].weatherCode)),
																			max: formatCompactTemp(stageForecasts[i].tMaxC, units),
																			min: formatCompactTemp(stageForecasts[i].tMinC, units),
																			precip: stageForecasts[i].precipProbPct,
																		})}
																	>
																		<span aria-hidden>
																			{weatherKeyToIcon(weatherCodeToKey(stageForecasts[i].weatherCode))}
																		</span>{' '}
																		{formatCompactTemp(stageForecasts[i].tMaxC, units)}
																	</span>,
																);
															}
															if (chips.length === 0) return null;
															const visibleChips = isActive ? chips : chips.slice(0, COLLAPSED_STAGE_CHIP_LIMIT);
															const overflowCount = isActive
																? 0
																: Math.max(0, chips.length - COLLAPSED_STAGE_CHIP_LIMIT);
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
																		gain: formatElevation(isNobo ? stats.lossM : stats.gainM, units),
																		loss: formatElevation(isNobo ? stats.gainM : stats.lossM, units),
																	})}
																	className="h-auto w-full rounded border border-gray-200 bg-white dark:border-[var(--border-color)]"
																	src={activeStageElevationThumb}
																/>
															)}
															{(() => {
																const sacBreakdown = stageSacByStage[i];
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
																							{formatDistance(
																								sacBreakdown?.kmByClass[c] ?? 0,
																								units,
																								distancePrecision,
																							)}
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
																					const bounds = `${toDisplay(s.fromKm).toFixed(1)}-${toDisplay(s.toKm).toFixed(1)} ${distanceUnitLabel}`;
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
																const acc = accommodationByStage[i];
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
															{waterGapByStage[i] !== undefined && (
																<p
																	className={cn(
																		'm-0 text-[0.625rem]',
																		waterGapByStage[i] >= WATER_GAP_DANGER_KM
																			? 'text-cldt-red'
																			: waterGapByStage[i] >= WATER_GAP_WARN_KM
																				? 'text-amber-700 dark:text-amber-400'
																				: 'text-gray-500 dark:text-[var(--text-secondary)]',
																	)}
																>
																	<span aria-hidden>💧</span>{' '}
																	{t('stageWaterGap', {
																		distance: `${toDisplay(waterGapByStage[i]).toFixed(0)} ${distanceUnitLabel}`,
																	})}
																</p>
															)}
															{packScenariosByStage[i] !== undefined && (
																<div className="m-0 flex flex-col gap-0.5 text-gray-500 dark:text-[var(--text-secondary)]">
																	<p className="m-0 text-[0.625rem] leading-snug">
																		<span aria-hidden>🎒</span>{' '}
																		{t('stagePackBase', {
																			weight: formatWeight(packScenariosByStage[i].baseKg, units),
																		})}
																	</p>
																	{packScenariosByStage[i].carryLiters > 0 ? (
																		<p className="m-0 text-[0.625rem] leading-snug">
																			{t('stagePackLoaded', {
																				weight: formatWeight(packScenariosByStage[i].loadedKg, units),
																				volume: formatVolume(packScenariosByStage[i].carryLiters, units),
																			})}
																		</p>
																	) : (
																		<p className="m-0 text-[0.625rem] leading-snug">{t('stagePackLoadedSame')}</p>
																	)}
																</div>
															)}
															{stageResupplyDetailLines(stageCadence).map((line) => (
																<p
																	className="m-0 text-[0.625rem] leading-snug text-amber-700 dark:text-amber-400"
																	key={line}
																>
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
																					aria-label={
																						isSelected
																							? tPois('exportDeselect', { name })
																							: tPois('exportSelect', { name })
																					}
																					checked={isSelected}
																					className="shrink-0"
																					title={
																						isSelected
																							? tPois('exportDeselect', { name })
																							: tPois('exportSelect', { name })
																					}
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
																				const xml = buildGpxWaypointXml(
																					waypoints,
																					t('stagePoisHeading', { index: i + 1 }),
																				);
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
												{Array.from({ length: restDayCountAfter(i, stagePlan.restDays) }, (_, occ) => {
													// The day offset is unique across the whole plan (each rest day
													// is a distinct calendar day), so it is a stable React key.
													const restOffset = dayOffsetForRestDayAfter(i, occ, stagePlan.restDays);
													const restDate = stagePlan.startDate
														? formatShortWeekdayDate(stageCalendarDate(stagePlan.startDate, restOffset), locale)
														: null;
													return (
														<div
															className="flex items-center gap-1.5 border-l-4 border-l-transparent bg-gray-50/70 px-2 py-1.5 text-xs text-gray-500 dark:bg-[var(--bg-hover)]/40 dark:text-[var(--text-secondary)]"
															key={`rest-${restOffset}`}
														>
															<IoBedOutline aria-hidden className="h-3.5 w-3.5 shrink-0" />
															<span className="font-medium">{t('restDayLabel')}</span>
															{restDate && (
																<span className="whitespace-nowrap text-gray-400 dark:text-[var(--text-secondary)]">
																	{restDate}
																</span>
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
											</React.Fragment>
										);
									})}
								</div>
							</MapControlSectionCard>
						)}

						{stagePlan && totalStageJunctions > 0 && (
							<MapControlSectionCard
								collapsible
								collapseLabel={sectionCollapseLabel}
								expandLabel={sectionExpandLabel}
								open={junctionsSectionOpen}
								title={tJunctions('sectionTitle')}
								onOpenChange={setJunctionsSectionOpen}
							>
								<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
									{tJunctions('branchesOff')}
								</p>
								{junctionsByStage.map((list, i) => {
									if (list.length === 0) return null;
									const stage = stagePlan.stages[i];
									const rows = isNobo ? [...list].reverse() : list;
									return (
										<div className="flex flex-col gap-0.5" key={`${stage.startKm}-${stage.endKm}`}>
											<p className="m-0 text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
												{i + 1}. {toDisplay(stage.startKm).toFixed(0)}-{toDisplay(stage.endKm).toFixed(0)}{' '}
												{distanceUnitLabel}
											</p>
											{rows.map((junction) => {
												const label = junctionLabel(junction, tJunctions('layerLabel'));
												return (
													<div
														className="flex items-center justify-between gap-2 px-0.5"
														key={junctionRowKey(junction)}
													>
														<span className="flex min-w-0 items-center gap-1.5">
															<span
																aria-hidden
																className="size-2 shrink-0 rounded-full"
																style={{ backgroundColor: junctionColor(junction) }}
															/>
															<span
																className="truncate text-xs text-gray-700 dark:text-[var(--text-primary)]"
																title={label}
															>
																{label}
															</span>
														</span>
														<span className="shrink-0 text-[0.625rem] text-gray-500 tabular-nums dark:text-[var(--text-secondary)]">
															{formatDistance(junction.trailKm, units, distancePrecision)}
														</span>
													</div>
												);
											})}
										</div>
									);
								})}
								<p className="m-0 text-[0.625rem] text-gray-400 italic dark:text-[var(--text-secondary)]">
									{tJunctions('provenance')}
								</p>
							</MapControlSectionCard>
						)}

						{stagePlan && (
							<MapControlSectionCard
								collapsible
								collapseLabel={sectionCollapseLabel}
								expandLabel={sectionExpandLabel}
								open={stagePlannerExportOpen}
								title={t('sections.export')}
								onOpenChange={setStagePlannerExportOpen}
							>
								<div className="flex flex-wrap gap-1.5">
									<SmartTooltip content={t('gpxExportTooltip')} position="top">
										<MapControlIconButton
											aria-label={t('gpxExport')}
											disabled={activeStageIndex === null}
											title={t('gpxExportTooltip')}
											variant="mapControlOutline"
											onClick={handleGpxExport}
										>
											<IoDownloadOutline aria-hidden className="h-3.5 w-3.5" />
										</MapControlIconButton>
									</SmartTooltip>
									<SmartTooltip content={t('fitExportTooltip')} position="top">
										<MapControlIconButton
											aria-label={t('fitExport')}
											disabled={activeStageIndex === null}
											title={t('fitExportTooltip')}
											variant="mapControlOutline"
											onClick={() => void handleFitExport()}
										>
											<IoWatchOutline aria-hidden className="h-3.5 w-3.5" />
										</MapControlIconButton>
									</SmartTooltip>
									<SmartTooltip content={t('gpxPoisExportTooltip')} position="top">
										<MapControlIconButton
											aria-label={t('gpxPoisExport')}
											disabled={allStagesWaypoints.length === 0}
											title={t('gpxPoisExportTooltip')}
											variant="mapControlOutline"
											onClick={handleAllStagesPoiExport}
										>
											<IoLocationOutline aria-hidden className="h-3.5 w-3.5" />
										</MapControlIconButton>
									</SmartTooltip>
									<SmartTooltip content={t('tripPackageExportTooltip')} position="top">
										<MapControlIconButton
											aria-label={t('tripPackageExport')}
											disabled={activeStageIndex === null}
											title={t('tripPackageExportTooltip')}
											variant="mapControlOutline"
											onClick={handleTripPackageExport}
										>
											<IoTrailSignOutline aria-hidden className="h-3.5 w-3.5" />
										</MapControlIconButton>
									</SmartTooltip>
									<SmartTooltip content={t('stripMapPdfTooltip')} position="top">
										<MapControlIconButton
											aria-label={t('stripMapPdf')}
											disabled={isPdfExporting}
											title={t('stripMapPdfTooltip')}
											variant="mapControlOutline"
											onClick={handleStripMapPdfExport}
										>
											<IoMapOutline aria-hidden className="h-3.5 w-3.5" />
										</MapControlIconButton>
									</SmartTooltip>
									<SmartTooltip
										content={stagePlan.startDate ? t('icalExportTooltip') : t('icalNeedsStartDate')}
										position="top"
									>
										<MapControlIconButton
											aria-label={t('icalExport')}
											disabled={!stagePlan.startDate}
											title={stagePlan.startDate ? t('icalExportTooltip') : t('icalNeedsStartDate')}
											variant="mapControlOutline"
											onClick={handleIcalExport}
										>
											<IoCalendarOutline aria-hidden className="h-3.5 w-3.5" />
										</MapControlIconButton>
									</SmartTooltip>
									<SmartTooltip content={t('tripBriefOpenTooltip')} position="top">
										<MapControlIconButton
											aria-label={t('tripBriefOpen')}
											disabled={stagePlan.stages.length === 0}
											title={t('tripBriefOpenTooltip')}
											variant="mapControlOutline"
											onClick={() => setIsTripBriefOpen(true)}
										>
											<IoDocumentTextOutline aria-hidden className="h-3.5 w-3.5" />
										</MapControlIconButton>
									</SmartTooltip>
								</div>
								{isPdfExporting && (
									<div className="flex items-center gap-2 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
										<span className="flex-1 tabular-nums">
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
								)}
							</MapControlSectionCard>
						)}

						{safetyContactPlan && (
							<MapControlSectionCard title={t('safetyContact.heading')}>
								<p className="m-0 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
									{t('safetyContact.intro')}
								</p>
								<div className="flex flex-col gap-0.5">
									<label
										className="text-xs text-gray-600 dark:text-[var(--text-secondary)]"
										htmlFor="safety-buffer-days"
									>
										{t('safetyContact.bufferLabel')}
									</label>
									<input
										className={cn(MAP_CONTROL_INPUT, 'w-20 text-right tabular-nums')}
										id="safety-buffer-days"
										max={30}
										min={0}
										step={1}
										type="number"
										value={safetyBuffer}
										onChange={(e) => {
											const v = Number(e.target.value);
											if (Number.isFinite(v) && v >= 0) setSafetyBuffer(Math.min(30, Math.round(v)));
										}}
									/>
								</div>
								<p className="m-0 max-h-32 overflow-y-auto rounded bg-gray-50 p-2 text-xs whitespace-pre-wrap text-gray-600 dark:bg-[var(--bg-secondary)] dark:text-[var(--text-primary)]">
									{safetyContactBody}
								</p>
								<div className="flex flex-wrap gap-2">
									<Button
										className={cn(safetyCopied && 'text-cldt-green')}
										size="sm"
										variant="mapControlOutlineSecondary"
										onClick={handleCopySafetyContact}
									>
										{t('safetyContact.copy')}
									</Button>
									{canShareSafety ? (
										<Button size="sm" variant="mapControlOutlineSecondary" onClick={handleShareSafetyContact}>
											{t('safetyContact.share')}
										</Button>
									) : null}
									{safetySmsHref ? (
										<a
											className={cn(buttonVariants({ variant: 'mapControlOutlineSecondary', size: 'sm' }))}
											href={safetySmsHref}
										>
											{t('safetyContact.text')}
										</a>
									) : null}
								</div>
								<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
									{t('safetyContact.notSharedNote')}
								</p>
							</MapControlSectionCard>
						)}
					</div>
				</div>

				{stagePlan && (
					<div className="shrink-0 border-t border-gray-200 pt-2 dark:border-[var(--border-color)]">
						{confirmReset ? (
							<div className="flex items-center gap-2 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
								<span className="flex-1">{t('confirmReset')}</span>
								<Button size="sm" variant="mapControlOutlineSecondary" onClick={handleConfirmReset}>
									{t('confirmYes')}
								</Button>
								<Button size="sm" variant="mapControlOutline" onClick={() => setConfirmReset(false)}>
									{t('confirmNo')}
								</Button>
							</div>
						) : (
							<Button
								className="w-full"
								size="sm"
								title={t('resetTooltip')}
								variant="mapControlOutlineSecondary"
								onClick={() => setConfirmReset(true)}
							>
								{t('reset')}
							</Button>
						)}
					</div>
				)}
			</div>
			<MapControlsTripBriefModal open={isTripBriefOpen} onClose={() => setIsTripBriefOpen(false)} />
		</>
	);
}
