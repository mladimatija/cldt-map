'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMap } from 'react-leaflet';
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
import type { StagePlanPreset, StagePlanPresetInputs } from '@/lib/store/types';
import { formatDistance, formatElevation } from '@/lib/format';
import { LINKABLE_PHONE_RE, toDialString } from '@/lib/url-safety';
import { kmToMiles, milesToKm } from '@/lib/units';
import { copyTextToClipboard } from '@/lib/share-link-copy';
import {
	buildSafetyContactPlan,
	buildSafetyContactPlanInput,
	DEFAULT_SAFETY_BUFFER_DAYS,
	safetyContactTemplates,
} from '@/lib/safety-contact-plan';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { usePopoverFocusTrap, usePackAdjustedPaceKmh } from '@/hooks';
import {
	buildResupplyCadenceLabels,
	collectResupplyTownPoints,
	computePlanResupplyCadence,
	type StageResupplyCadence,
	type StageResupplyStatus,
} from '@/lib/resupply-cadence';
import { computeStagePackScenarios, formatFoodRate } from '@/lib/pack-weight';
import {
	splitByDistance,
	splitByEta,
	computeStageStats,
	computeMinStagesForCap,
	stagePlanDirection,
	toStoredStagePlan,
	travelProfile,
	DEFAULT_MAX_HOURS_PER_DAY,
} from '@/lib/stage-planner';
import { toTravelRange } from '@/lib/trail-frame';
import { findNearestPointIndex, formatEta } from '@/lib/distance-utils';
import { useStageForecasts } from '@/hooks/useStageForecasts';
import { isUsableWaterSource, longestDryStretchKm, poiWaterReliability } from '@/lib/water-intelligence';
import {
	buildGpxTrackWithWaypointsXml,
	buildGpxXml,
	buildGpxWaypointXml,
	downloadGpxFile,
	type GpxDocMeta,
	type GpxWaypoint,
} from '@/lib/gpx-export';
import { sacMaxForKmRange } from '@/lib/trail-osm-tags';
import { hasTrailJunctions, type TrailJunction } from '@/lib/trail-junctions';
import { dominantSurfaceForKmRange } from '@/lib/surface-section-stats';
import { computeStageSacBreakdown, type StageSacBreakdown } from '@/lib/stage-sac-stats';
import { findToughestStretches, type ToughestStretch } from '@/lib/terrain-highlights';
import { SAC_BUCKET_SHORT_LABELS } from '@/components/map/trail-route-constants';
import { siteMetadata } from '@/lib/metadata';
import { buildFitCourseBytes, downloadFitFile } from '@/lib/fit-export';
import { exportStripMapPdf, pointsToBounds } from '@/lib/export-utils';
import {
	buildStagePlanIcs,
	downloadIcsFile,
	stageCalendarDate,
	type StageIcalEventInput,
} from '@/lib/stage-ical-export';
import { dayOffsetForRestDayAfter, dayOffsetForStage, normalizeRestDays } from '@/lib/stage-rest-days';
import { formatShortWeekdayDate } from '@/lib/date-format';
import { TRAIL_OFF_TRAIL_THRESHOLD_M } from '@/lib/config';
import { resolveTrailAnchor, formatAheadHorizon } from '@/lib/poi-ahead-corridor';
import { renderElevationThumbnail } from '@/lib/elevation-thumbnail';

const MAX_STAGES = 200;

/** Curated POI types packed into the combined "trip package" GPX: the
 *  safety / resupply markers a hiker needs alongside the line to follow.
 *  Settlements and road-access clutter are deliberately left out; personal
 *  notes and starred state are never read (privacy-first, curated data only). */
const TRIP_PACKAGE_POI_TYPES: ReadonlySet<string> = new Set(['water', 'hut', 'shelter', 'town']);

/** State, derived data and handlers of the stage planner, shared by its cards. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the returned object is the cards' contract; StagePlannerData is its inferred type
export function useStagePlannerData() {
	const t = useTranslations('stagePlanner');
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
	const direction = useMapStore((s: MapStoreState) => s.direction);
	/** A stored plan is shown in the direction it was made for (its days are in
	 *  that travel order); new plans are generated for the current direction. */
	const planDirection = stagePlan ? stagePlanDirection(stagePlan) : direction;
	const isNobo = planDirection === 'NOBO';
	const planIsForOtherDirection = planDirection !== direction;
	const trailTotalKm = trailMetadata?.totalDistance ?? 0;
	/** Stored stages are SOBO ranges; show them as the hiker meets them (travel km, start first). */
	const travelRange = useCallback(
		(stage: { startKm: number; endKm: number }): { from: number; to: number } =>
			toTravelRange(stage.startKm, stage.endKm, planDirection, trailTotalKm),
		[planDirection, trailTotalKm],
	);

	const map = useMap();
	const popoverRef = usePopoverFocusTrap(true);

	const isImperial = units === 'imperial';

	// Only whether there is an anchor: the planner shows its preview-ahead button
	// then, and must not re-render on every GPS fix that moves the anchor.
	const hasTrailAnchor = useStore(
		(s: StoreState) => resolveTrailAnchor(s.closestPoint, rulerRange, TRAIL_OFF_TRAIL_THRESHOLD_M) !== null,
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

	const toDisplay = useCallback(
		(km: number): number => (isImperial ? Math.round(kmToMiles(km) * 10) / 10 : km),
		[isImperial],
	);
	const fromDisplay = (display: number): number => (isImperial ? milesToKm(display) : display);

	// One batched Open-Meteo call per plan; null per stage outside the horizon.
	const stageForecasts = useStageForecasts(stagePlan, enhancedTrailPoints);

	const stageStats = useMemo(() => {
		if (!stagePlan || !enhancedTrailPoints?.length) return [];
		return stagePlan.stages.map((stage) =>
			computeStageStats(stage, enhancedTrailPoints, walkingPaceKmh, gradeAdjustedEta, planDirection),
		);
	}, [stagePlan, enhancedTrailPoints, walkingPaceKmh, gradeAdjustedEta, planDirection]);

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
	const addRestDayAfter = useCallback(
		(index: number): void => {
			if (!stagePlan) return;
			setStagePlan({ ...stagePlan, restDays: normalizeRestDays([...(stagePlan.restDays ?? []), index]) });
		},
		[stagePlan, setStagePlan],
	);

	/** Remove a single rest day anchored after stage `index`. */
	const removeRestDayAfter = useCallback(
		(index: number): void => {
			if (!stagePlan?.restDays?.length) return;
			const at = stagePlan.restDays.indexOf(index);
			if (at === -1) return;
			const next = stagePlan.restDays.filter((_, i) => i !== at);
			setStagePlan({ ...stagePlan, restDays: next.length > 0 ? next : undefined });
		},
		[stagePlan, setStagePlan],
	);

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

	/** `restDays` carries an existing plan's rest days over (anchors past the new
	 *  last stage are dropped). */
	const runGenerate = (inputs: StagePlanPresetInputs, restDays?: number[]): void => {
		if (!enhancedTrailPoints?.length) return;
		// The typed range is travel km, so split a travel-ordered profile and then
		// store each stage as a SOBO range (stages stay in travel order).
		const profile = travelProfile(enhancedTrailPoints, direction);
		const safeKmPerDay = Math.max(0.1, inputs.kmPerDayKm);
		const safeStageCount = Math.min(MAX_STAGES, Math.max(1, inputs.stageCount));
		const requestedCount =
			inputs.mode === 'stages'
				? safeStageCount
				: Math.min(MAX_STAGES, Math.max(1, Math.ceil((inputs.endKm - inputs.startKm) / safeKmPerDay)));
		const minCount = computeMinStagesForCap(
			profile,
			inputs.startKm,
			inputs.endKm,
			walkingPaceKmh,
			gradeAdjustedEta,
			inputs.maxHoursPerDay,
		);
		const finalCount = Math.min(MAX_STAGES, Math.max(requestedCount, minCount));
		setAutoBumpNotice(finalCount > requestedCount ? { requested: requestedCount, actual: finalCount } : null);
		const plan = inputs.balanceByEta
			? splitByEta(profile, inputs.startKm, inputs.endKm, walkingPaceKmh, gradeAdjustedEta, finalCount)
			: splitByDistance(inputs.startKm, inputs.endKm, (inputs.endKm - inputs.startKm) / finalCount);
		const keptRestDays = normalizeRestDays(restDays).filter((k) => k < plan.stages.length);
		setStagePlan(
			toStoredStagePlan(
				{
					...plan,
					startDate: inputs.startDate || undefined,
					...(keptRestDays.length > 0 && { restDays: keptRestDays }),
				},
				direction,
				trailTotalKm,
			),
		);
		setActiveStageIndex(0);
		setSelectedStagePoiIdsByStage(new Map());
		setConfirmReset(false);
		setStagePlannerSetupOpen(false);
		setStagePlannerStagesOpen(true);
	};

	const handleGenerate = (): void => runGenerate(currentPlannerInputs());

	/** Re-split a plan made for the other direction over the same stretch for the
	 *  current one, keeping its day count, balance mode, start date and rest days.
	 *  The form fields are not used: they reset on every mount and need not
	 *  describe the stored plan. */
	const handleRegenerateForDirection = (): void => {
		if (!stagePlan) return;
		const range = toTravelRange(stagePlan.startKm, stagePlan.endKm, direction, trailTotalKm);
		runGenerate(
			{
				startKm: range.from,
				endKm: range.to,
				mode: 'stages',
				kmPerDayKm,
				stageCount: stagePlan.stages.length,
				balanceByEta: stagePlan.balanceMode === 'eta',
				maxHoursPerDay,
				startDate: stagePlan.startDate,
			},
			stagePlan.restDays,
		);
	};

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

	/** The row passes whether it is the open one, so this needs no dependency on
	 *  the active index and the memoized rows keep their props when it changes. */
	const handleStageClick = useCallback(
		(index: number, isActive: boolean): void => {
			if (isActive) {
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
		},
		[stagePlan, enhancedTrailPoints, map],
	);

	/** Document-level metadata for a stage GPX export: stage stats (already in
	 *  the travel direction), plus SAC/surface difficulty over the stage's SOBO km
	 *  window. SAC/surface are added only when the OSM tag dataset is loaded, so
	 *  the export stays valid without it. */
	const buildStageMeta = (
		stage: { startKm: number; endKm: number },
		stats: { distanceM: number; gainM: number; lossM: number; etaSec: number },
		index: number,
	): GpxDocMeta => {
		const parts: string[] = [
			tGpxMeta('descDistance', { value: formatDistance(stats.distanceM / 1000, units, distancePrecision) }),
			tGpxMeta('descAscent', { value: formatElevation(stats.gainM, units) }),
			tGpxMeta('descDescent', { value: formatElevation(stats.lossM, units) }),
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

	/** NOBO-aware enhanced-point slice within a stage's [startKm, endKm] km window,
	 *  in travel order (reversed for NOBO) - the shared body of the three stage-track
	 *  exporters. Each caller maps the returned points to its own export shape and
	 *  keeps its own length guard: handleFitExport / handleTripPackageExport bail on
	 *  a < 2-point slice, while handleGpxExport intentionally does not (its behaviour
	 *  is preserved exactly). Returns [] only when there are no enhanced points,
	 *  which the callers already guard against before calling. */
	const sliceStagePoints = (stage: { startKm: number; endKm: number }): NonNullable<typeof enhancedTrailPoints> => {
		if (!enhancedTrailPoints?.length) return [];
		const startIdx = findNearestPointIndex(enhancedTrailPoints, stage.startKm * 1000);
		const endIdx = findNearestPointIndex(enhancedTrailPoints, stage.endKm * 1000);
		const pts = enhancedTrailPoints.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);
		return isNobo ? [...pts].reverse() : pts;
	};

	const handleGpxExport = (): void => {
		if (activeStageIndex === null || !stagePlan || !enhancedTrailPoints?.length) return;
		const stage = stagePlan.stages[activeStageIndex];
		const pts = sliceStagePoints(stage);
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
		const pts = sliceStagePoints(stage);
		if (pts.length < 2) return;
		const stats = stageStats[activeStageIndex];
		const fitBytes = await buildFitCourseBytes({
			points: pts.map((p) => ({ lat: p.lat, lng: p.lng, elevation: p.elevation })),
			courseName: `CLDT Stage ${activeStageIndex + 1}`,
			totalAscentM: stats?.gainM,
			totalDescentM: stats?.lossM,
		});
		downloadFitFile(fitBytes, `cldt-stage-${activeStageIndex + 1}.fit`);
	};

	const handleIcalExport = (): void => {
		if (!stagePlan?.startDate || stagePlan.stages.length === 0 || stageStats.length === 0) return;
		const events = stagePlan.stages.map((stage, index) => {
			const stats = stageStats[index];
			const range = travelRange(stage);
			const startDisplay = toDisplay(range.from).toFixed(1);
			const endDisplay = toDisplay(range.to).toFixed(1);
			const distDisplay = toDisplay(stats.distanceM / 1000).toFixed(1);
			const { gainM, lossM } = stats;
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
					t('icalDirection', { direction: planDirection }),
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
				walkingPaceKmh,
				gradeAdjustedEta,
				units,
				map,
				(current, total) => setPdfProgress({ current, total }),
				t('pdfStageLabel'),
				leafletEl,
				controller.signal,
				(index) => setActiveStageIndex(index),
				planDirection,
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
		return findToughestStretches(
			enhancedTrailPoints,
			stage.startKm,
			stage.endKm,
			trailOsmTagsFile?.runs ?? [],
			3,
			planDirection,
		);
	}, [activeStageIndex, stagePlan, enhancedTrailPoints, trailOsmTagsFile, planDirection]);

	const distanceUnitLabel = isImperial ? 'mi' : 'km';
	const valueUnitLabel = mode === 'stages' ? t('modeStages') : `${distanceUnitLabel}/day`;
	const showMaxHoursRow = balanceByEta || mode === 'kmPerDay';

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
		// The day ends at the SOBO end southbound and at the SOBO start northbound.
		return stagePlan.stages.map((s) => findStageEndAccommodation(isNobo ? s.startKm : s.endKm, overnightPois));
	}, [stagePlan, overnightPois, isNobo]);

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
		return computePlanResupplyCadence(stagePlan.stages, poisFile.pois, resupplyPoints, planDirection);
	}, [stagePlan, poisFile, planDirection]);

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
				rateLabel: formatFoodRate(foodConsumptionKgPerDay, units),
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
		const pts = sliceStagePoints(stage);
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

	const handlePoiClick = useCallback((poi: Poi): void => requestOpenPoi(poi.id), [requestOpenPoi]);

	/** Each stage's range as the hiker meets it, one object per stage so the
	 *  memoized rows get the same range until the plan or direction changes. */
	const stageRanges = useMemo(
		() =>
			stagePlan?.stages.map((stage) => toTravelRange(stage.startKm, stage.endKm, planDirection, trailTotalKm)) ?? [],
		[stagePlan, planDirection, trailTotalKm],
	);

	/** Stage POIs in the order the hiker passes them. */
	const stagePoisInTravelOrder = useMemo(
		() => (isNobo ? poisByStage.map((pois) => [...pois].reverse()) : poisByStage),
		[poisByStage, isNobo],
	);

	/** What every stage row shares; one object, so a row re-renders only when
	 *  this or its own stage values change. */
	const stageRowShared = useMemo(
		() => ({
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
		}),
		[
			addRestDayAfter,
			distancePrecision,
			distanceUnitLabel,
			handlePoiClick,
			handleStageClick,
			locale,
			removeRestDayAfter,
			resupplyStatusLabel,
			stageResupplyDetailLines,
			t,
			toDisplay,
			tPois,
			travelRange,
			tWeather,
			units,
		],
	);

	return {
		accommodationByStage,
		activeStageElevationThumb,
		activeStageIndex,
		activeStageToughestStretches,
		addRestDayAfter,
		aheadHorizonLabel,
		allStagesWaypoints,
		applyStagePreset,
		autoBumpNotice,
		balanceByEta,
		canShareSafety,
		confirmReset,
		deleteStagePlanPreset,
		distancePrecision,
		distanceUnitLabel,
		endKm,
		fromDisplay,
		handleAllStagesPoiExport,
		handleCancelPdfExport,
		handleConfirmReset,
		handleCopySafetyContact,
		handleFitExport,
		handleGenerate,
		handleGpxExport,
		handleIcalExport,
		handlePoiClick,
		handleRegenerateForDirection,
		handleSaveStagePreset,
		handleShareSafetyContact,
		handleStageClick,
		handleStripMapPdfExport,
		handleTripPackageExport,
		handleTripStartDateChange,
		hasTrailAnchor,
		highlightPositions,
		isImperial,
		isNobo,
		isPdfExporting,
		isSavingStagePreset,
		isTripBriefOpen,
		junctionsByStage,
		junctionsSectionOpen,
		kmPerDayKm,
		locale,
		maxHoursPerDay,
		mode,
		openHelpToPlanning,
		packScenariosByStage,
		pdfProgress,
		planIsForOtherDirection,
		planResupplyCadence,
		poisByStage,
		popoverRef,
		removeRestDayAfter,
		requestPoiListAhead,
		restDayCount,
		resupplyStatusLabel,
		safetyBuffer,
		safetyContactBody,
		safetyContactPlan,
		safetyCopied,
		safetySmsHref,
		selectedStagePoiIdsByStage,
		setBalanceByEta,
		setConfirmReset,
		setEndKm,
		setIsSavingStagePreset,
		setIsTripBriefOpen,
		setJunctionsSectionOpen,
		setKmPerDayKm,
		setMaxHoursPerDay,
		setMode,
		setSafetyBuffer,
		setSelectedStagePoiIdsByStage,
		setStageCount,
		setStagePlannerExportOpen,
		setStagePlannerSetupOpen,
		setStagePlannerStagesOpen,
		setStagePresetName,
		setStartKm,
		showMaxHoursRow,
		stageCount,
		stageDateLabels,
		stageForecasts,
		stagePlan,
		stagePlannerExportOpen,
		stagePlannerSetupOpen,
		stagePlannerStagesOpen,
		stagePlanPresets,
		stagePoisInTravelOrder,
		stagePresetName,
		stageRanges,
		stageResupplyDetailLines,
		stageRowShared,
		stageSacByStage,
		stageStats,
		startKm,
		t,
		tJunctions,
		toDisplay,
		totalStageJunctions,
		tPois,
		trailMetadata,
		travelRange,
		tripNextGroceryTown,
		tripStartDate,
		tripTotalDistance,
		tWeather,
		units,
		valueUnitLabel,
		walkingPaceKmh,
		waterGapByStage,
	};
}

export type StagePlannerData = ReturnType<typeof useStagePlannerData>;
