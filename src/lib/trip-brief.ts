/**
 * Trip brief data model + assembler. Aggregates the stage plan, selected POIs,
 * seasonal status, and (later) weather into a single structured object that
 * the PDF, DOCX, and HTML generators consume.
 *
 * Day narratives default to deterministic templated strings. Optional
 * AI-written paragraphs are applied after assembly via `trip-brief-ai.ts`
 * when the user enables them in the trip brief modal (online, `/api/narrative`).
 * The modal then offers a pre-export edit step; `applyNarrativeEdits` merges
 * the user's changes before PDF/DOCX/HTML generation.
 */

import { computeStageStats } from '@/lib/stage-planner';
import { isUsableWaterSource, longestDryStretchKm } from '@/lib/water-intelligence';
import {
	collectResupplyTownPoints,
	computePlanResupplyCadence,
	type StageResupplyCadence,
} from '@/lib/resupply-cadence';
import { formatEta } from '@/lib/distance-utils';
import { formatDistance } from '@/lib/utils';
import {
	isKnownType,
	pickThumbUrl,
	poiDisplayName,
	poiMatchesTagFilter,
	poiPassesReachabilityFilter,
	STAGE_POI_OFFTRAIL_KM,
	type Poi,
	type PoisFile,
} from '@/lib/pois';
import { formatDayNarrative, formatOverviewNarrative, type TripBriefStrings } from '@/lib/trip-brief-i18n';
import {
	dayOffsetForRestDayAfter,
	dayOffsetForStage,
	normalizeRestDays,
	restDayCountAfter,
} from '@/lib/stage-rest-days';
import { stageCalendarDate } from '@/lib/stage-ical-export';
import type { EnhancedTrailPoint, StagePlan, TrailDirection, UnitSystem } from '@/lib/store/types';
import type { SeasonalStatusEntry } from '@/lib/seasonal-status';
import type { Locale } from '@/i18n/routing';

export interface TripBriefMeta {
	title: string;
	generatedAt: string;
	locale: Locale;
	direction: TrailDirection;
	units: UnitSystem;
	walkingPaceKmh: number;
	gradeAdjustedEta: boolean;
	startDate?: string;
	/** Localized accuracy disclaimer, set (from messages/*.json, where all
	 *  user-facing copy lives) when the narrative slots were filled by the AI
	 *  route. Renderers print it on the cover whenever present - the exporters
	 *  run outside React/next-intl, so the caller resolves the string. */
	aiDisclaimer?: string;
	/** Active locale's exporter strings (messages tripBrief.document subtree),
	 *  resolved by the caller via useMessages() - the PDF/DOCX generators run
	 *  outside React/next-intl and read everything from here. */
	strings: TripBriefStrings;
	/** Localized pack summary for the cover table ("10.2 kg + water"),
	 *  resolved by the caller. Absent when the pack-weight feature is off. */
	packSummary?: string;
	/** Localized food resupply cadence summary for the cover table. */
	resupplySummary?: string;
	/** Localized "for your safety contact" section heading; falls back to
	 *  `strings.labels.safetyContact` in the exporters when absent. */
	safetyContactHeading?: string;
	/** Localized safety-contact handoff lines (intro, per-day, closing) for the
	 *  emergency back page. Built by the caller via `buildSafetyContactPlan`. */
	safetyContactLines?: string[];
	/** Fully resolved gear checklist page content (imported pack list);
	 *  absent when no CSV was imported. */
	gearChecklist?: {
		heading: string;
		/** Optional "recommended gear not found" warning line. */
		missingLine?: string;
		categories: { name: string; lines: string[] }[];
	};
}

export interface TripBriefPoi {
	id: string;
	name: string;
	type: string;
	typeLabel: string;
	trailKm: number;
	distanceFromTrailKm: number;
	summary?: string;
	thumbUrl?: string;
	attribution?: string;
	/** True when the town has at least one grocery in its resupply data. */
	resupply?: boolean;
	wikipediaUrl?: string;
}

export interface TripBriefSeasonalAlert {
	id: string;
	severity: string;
	title: string;
	fromKm: number;
	toKm: number;
}

export interface TripBriefDay {
	/** Whether this entry is a hiking stage or a planned rest (zero) day. */
	kind: 'stage' | 'rest';
	/** Stable, position-independent id for React keys / HTML ids. Stage days use
	 *  `stage-${i}`; rest days use `rest-${i}-${occ}` (anchor stage + occurrence). */
	dayId: string;
	/** Calendar date (yyyy-mm-dd); present only when the plan has a start date. */
	date?: string;
	index: number;
	stageId?: string;
	startKm: number;
	endKm: number;
	directionStartKm: number;
	directionEndKm: number;
	distanceLabel: string;
	gainM: number;
	lossM: number;
	etaSec: number;
	narrative: string;
	pois: TripBriefPoi[];
	seasonalAlerts: TripBriefSeasonalAlert[];
	/** Localized base-pack line for the day page; present when pack weight is on. */
	packBaseLabel?: string;
	/** Localized max-load line when the stage needs extra water carry. */
	packLoadedLabel?: string;
	/** Localized line when entering the stage without a recent grocery resupply. */
	resupplyEnteringLabel?: string;
	/** Localized carry-through line when grocery resupply is missing or partial. */
	resupplyCarryLabel?: string;
	/** Localized pack consumables vs hiking days estimate. */
	foodPackLabel?: string;
	/** PNG data URL of the day's elevation profile, attached by the modal
	 *  after assembly (canvas is a browser API; the assembler stays pure). */
	elevationThumb?: string;
}

export interface TripBriefOverview {
	totalKm: number;
	totalGainM: number;
	totalLossM: number;
	dayCount: number;
	narrative: string;
	totalDurationSec: number;
}

export interface TripBrief {
	meta: TripBriefMeta;
	overview: TripBriefOverview;
	days: TripBriefDay[];
}

export interface TripBriefAssemblyArgs {
	/** Exporter strings for the active locale (tripBrief.document subtree). */
	strings: TripBriefStrings;
	stagePlan: StagePlan;
	poisFile: PoisFile | null;
	enhancedTrailPoints: EnhancedTrailPoint[];
	/** Elevation profile points. Accepts EnhancedTrailPoint[] directly since
	 *  EnhancedTrailPoint is a superset of { elevation, distanceFromStart }
	 *  - passing enhancedTrailPoints here avoids a redundant remap at the call site. */
	elevationPoints: { elevation: number; distanceFromStart: number }[] | EnhancedTrailPoint[];
	selectedPoiIds: ReadonlySet<string>;
	/** When true, include every POI, whose `trailKm` falls in a stage's window
	 *  (subject to the off-trail cap). Otherwise, only `selectedPoiIds` are
	 *  included. */
	includeAllInStage: boolean;
	enabledPoiTypes: ReadonlySet<string>;
	/** Per-tag filter consistent with the map renderer and list panel.
	 *  Empty set means "no tag filter active" (all types passing the type filter
	 *  are included). Non-empty set requires tag intersection via poiMatchesTagFilter. */
	enabledPoiTags: ReadonlySet<string>;
	/** Same reachability filter as the map renderer (Settings toggle). */
	includeRemotePois: boolean;
	walkingPaceKmh: number;
	gradeAdjustedEta: boolean;
	units: UnitSystem;
	direction: TrailDirection;
	locale: Locale;
	title: string;
	seasonalEntries: SeasonalStatusEntry[];
	startDate?: string;
	/** Localized type-label resolver (typically wraps `t('type.X')` from
	 *  next-intl). Falls back to the raw type string if missing. */
	typeLabel: (type: string) => string;
	/** Localized distance label resolver - keeps the brief unit-aware. */
	distanceLabel: (km: number) => string;
	/** Localized pack summary for the cover; omit when the feature is off. */
	packSummary?: string;
	/** Per-day base vs loaded pack resolver; receives the stage's longest dry
	 *  stretch in km. Keeps pack math at the call site. */
	packScenarioLabels?: (dryStretchKm: number) => { base: string; loaded?: string } | undefined;
	/** Fully resolved gear checklist content; passed through to the meta. */
	gearChecklist?: TripBriefMeta['gearChecklist'];
	/** Resolve a resupply town POI id to a display name. */
	poiName?: (id: string) => string;
	/** Build localized resupply cadence strings (cover + per-day). */
	resupplyCadenceLabels?: (
		cadence: StageResupplyCadence,
		stageIndex: number,
	) => {
		entering?: string;
		carry?: string;
		foodPack?: string;
	};
	/** Build the cover resupply summary from plan-level cadence. */
	resupplySummaryLabel?: (args: {
		maxFoodGapKm: number;
		nextTown?: string;
		nextDistanceKm?: number;
	}) => string | undefined;
	/** Localized "for your safety contact" section heading; passed through to
	 *  the meta so the exporters can title the back-page sub-block. */
	safetyContactHeading?: string;
	/** Localized safety-contact handoff lines; passed through to the meta. The
	 *  assembler stays pure - the accommodation math lives at the call site. */
	safetyContactLines?: string[];
}

/**
 * Pure assembler. Takes the structured inputs and returns a `TripBrief`. No
 * side effects, no async, no API calls. The PDF/DOCX generator handles map
 * snapshots and binary rendering.
 */
export function assembleTripBrief(args: TripBriefAssemblyArgs): TripBrief {
	const {
		stagePlan,
		poisFile,
		enhancedTrailPoints,
		elevationPoints,
		selectedPoiIds,
		includeAllInStage,
		enabledPoiTypes,
		enabledPoiTags,
		includeRemotePois,
		walkingPaceKmh,
		gradeAdjustedEta,
		units,
		direction,
		locale,
		title,
		seasonalEntries,
		startDate,
		typeLabel,
		distanceLabel,
		strings,
		packSummary,
		packScenarioLabels,
		gearChecklist,
		resupplyCadenceLabels,
		resupplySummaryLabel,
		safetyContactHeading,
		safetyContactLines,
	} = args;

	const resupplyPoints =
		poisFile?.pois?.length && resupplyCadenceLabels ? collectResupplyTownPoints(poisFile.pois) : [];
	const planResupplyCadence =
		resupplyPoints.length > 0 && stagePlan.stages.length > 0
			? computePlanResupplyCadence(stagePlan.stages, poisFile?.pois ?? [], resupplyPoints)
			: null;

	const resupplySummary =
		planResupplyCadence && resupplySummaryLabel
			? resupplySummaryLabel({
					maxFoodGapKm: planResupplyCadence.maxFoodGapKm,
					...(planResupplyCadence.firstGrocery &&
						planResupplyCadence.kmToFirstGrocery !== null && {
							nextTown: args.poiName?.(planResupplyCadence.firstGrocery.id),
							nextDistanceKm: planResupplyCadence.kmToFirstGrocery,
						}),
				})
			: undefined;

	const totalKm =
		stagePlan.stages.length > 0 ? stagePlan.stages[stagePlan.stages.length - 1].endKm - stagePlan.stages[0].startKm : 0;

	const visiblePois = (poisFile?.pois ?? []).filter(
		(p) =>
			isKnownType(p.type) &&
			enabledPoiTypes.has(p.type) &&
			poiMatchesTagFilter(p, enabledPoiTags) &&
			poiPassesReachabilityFilter(p, includeRemotePois) &&
			p.distanceFromTrailKm <= STAGE_POI_OFFTRAIL_KM,
	);
	// Sort once by trailKm so each stage's POI window can be located with a
	// pair of binary searches instead of a fresh O(P) filter per stage.
	const visiblePoisByKm = [...visiblePois].sort((a, b) => a.trailKm - b.trailKm);

	const trailTotalKm = enhancedTrailPoints.length
		? enhancedTrailPoints[enhancedTrailPoints.length - 1].distanceFromStart / 1000
		: 0;

	const isNobo = direction === 'NOBO';

	/** Usable water source positions for the carry lines; like the planner,
	 *  computed from the full dataset rather than the visible POI subset. */
	const waterSourceKms =
		packScenarioLabels === undefined
			? []
			: (poisFile?.pois ?? []).filter((p) => p.type === 'water' && isUsableWaterSource(p.water)).map((p) => p.trailKm);

	let totalGainM = 0;
	let totalLossM = 0;
	let totalDurationSec = 0;

	// Rest days never repartition the trail; they only push the calendar date of
	// every later stage and surface as their own first-class day entries. The
	// helpers in stage-rest-days.ts are the single source of truth for the math.
	const restDays = normalizeRestDays(stagePlan.restDays);

	const days: TripBriefDay[] = [];
	stagePlan.stages.forEach((stage, i) => {
		const stats = computeStageStats(stage, enhancedTrailPoints, elevationPoints, walkingPaceKmh, gradeAdjustedEta);
		// Direction-aware accounting: in NOBO, what was uphill SOBO becomes
		// downhill and vice versa. The narrative + UI both want the values
		// as the hiker will experience them in their walking direction.
		const dirGain = isNobo ? stats.lossM : stats.gainM;
		const dirLoss = isNobo ? stats.gainM : stats.lossM;
		totalGainM += dirGain;
		totalLossM += dirLoss;
		totalDurationSec += stats.etaSec;

		const directionStartKm = isNobo ? Math.max(0, trailTotalKm - stage.endKm) : stage.startKm;
		const directionEndKm = isNobo ? Math.max(0, trailTotalKm - stage.startKm) : stage.endKm;

		const stagePois = collectStagePois(
			visiblePoisByKm,
			stage,
			isNobo,
			selectedPoiIds,
			includeAllInStage,
			locale,
			typeLabel,
		);
		const stageAlerts = collectStageAlerts(seasonalEntries, stage, locale);

		const packLabels =
			packScenarioLabels && waterSourceKms.length > 0
				? packScenarioLabels(longestDryStretchKm(stage.startKm, stage.endKm, waterSourceKms))
				: undefined;

		const stageCadence = planResupplyCadence?.stages[i];
		const resupplyLabels = stageCadence && resupplyCadenceLabels ? resupplyCadenceLabels(stageCadence, i) : undefined;

		days.push({
			kind: 'stage',
			dayId: `stage-${i}`,
			...(startDate && { date: stageCalendarDate(startDate, dayOffsetForStage(i, restDays)) }),
			index: i,
			stageId: `stage-${i}`,
			startKm: stage.startKm,
			endKm: stage.endKm,
			directionStartKm,
			directionEndKm,
			distanceLabel: distanceLabel(stage.endKm - stage.startKm),
			gainM: dirGain,
			lossM: dirLoss,
			etaSec: stats.etaSec,
			narrative: formatDayNarrative({
				day: i + 1,
				totalDays: stagePlan.stages.length,
				distanceLabel: distanceLabel(stage.endKm - stage.startKm),
				gainM: dirGain,
				lossM: dirLoss,
				poiCount: stagePois.length,
				strings,
			}),
			pois: stagePois,
			seasonalAlerts: stageAlerts,
			...(packLabels?.base && { packBaseLabel: packLabels.base }),
			...(packLabels?.loaded && { packLoadedLabel: packLabels.loaded }),
			...(resupplyLabels?.entering && { resupplyEnteringLabel: resupplyLabels.entering }),
			...(resupplyLabels?.carry && { resupplyCarryLabel: resupplyLabels.carry }),
			...(resupplyLabels?.foodPack && { foodPackLabel: resupplyLabels.foodPack }),
		});

		// Emit any rest days anchored after this stage, in calendar order. They
		// carry no distance / gain / POIs and contribute nothing to the totals;
		// `index: i` anchors them to the stage so renderers keep stage numbering.
		const restCount = restDayCountAfter(i, restDays);
		for (let occ = 0; occ < restCount; occ++) {
			days.push({
				kind: 'rest',
				dayId: `rest-${i}-${occ}`,
				...(startDate && { date: stageCalendarDate(startDate, dayOffsetForRestDayAfter(i, occ, restDays)) }),
				index: i,
				startKm: stage.endKm,
				endKm: stage.endKm,
				directionStartKm: 0,
				directionEndKm: 0,
				distanceLabel: '',
				gainM: 0,
				lossM: 0,
				etaSec: 0,
				narrative: strings.restDay.body,
				pois: [],
				seasonalAlerts: [],
			});
		}
	});

	const overview: TripBriefOverview = {
		totalKm,
		totalGainM,
		totalLossM,
		dayCount: stagePlan.stages.length,
		totalDurationSec,
		narrative: formatOverviewNarrative({
			totalDistanceLabel: distanceLabel(totalKm),
			dayCount: stagePlan.stages.length,
			direction,
			strings,
			etaLabel: formatEta(totalDurationSec),
		}),
	};

	return {
		meta: {
			title,
			generatedAt: new Date().toISOString(),
			locale,
			direction,
			units,
			walkingPaceKmh,
			gradeAdjustedEta,
			strings,
			...(startDate && { startDate }),
			...(packSummary && { packSummary }),
			...(resupplySummary && { resupplySummary }),
			...(gearChecklist && { gearChecklist }),
			...(safetyContactHeading && { safetyContactHeading }),
			...(safetyContactLines?.length && { safetyContactLines }),
		},
		overview,
		days,
	};
}

/** Binary search for the leftmost index `i` where `pois[i].trailKm >= target`.
 *  Assumes `pois` is already sorted ascending by trailKm. Returns `pois.length`
 *  when no such index exists. */
function lowerBoundByTrailKm(pois: Poi[], target: number): number {
	let lo = 0;
	let hi = pois.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (pois[mid].trailKm < target) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** Binary search for the leftmost index `i` where `pois[i].trailKm > target`.
 *  Used as the exclusive upper bound for an inclusive `[lo, hi]` km window. */
function upperBoundByTrailKm(pois: Poi[], target: number): number {
	let lo = 0;
	let hi = pois.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (pois[mid].trailKm <= target) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function collectStagePois(
	visiblePoisByKm: Poi[],
	stage: { startKm: number; endKm: number },
	isNobo: boolean,
	selectedPoiIds: ReadonlySet<string>,
	includeAllInStage: boolean,
	locale: string,
	typeLabel: (t: string) => string,
): TripBriefPoi[] {
	const lo = Math.min(stage.startKm, stage.endKm);
	const hi = Math.max(stage.startKm, stage.endKm);
	// Locate the inclusive [lo, hi] window in the pre-sorted superset with
	// two binary searches instead of a fresh O(P) filter per stage. slice
	// returns a fresh array, so the later reverse() doesn't mutate the
	// shared input.
	const start = lowerBoundByTrailKm(visiblePoisByKm, lo);
	const end = upperBoundByTrailKm(visiblePoisByKm, hi);
	let inStage = visiblePoisByKm.slice(start, end);
	if (!includeAllInStage) {
		inStage = inStage.filter((p) => selectedPoiIds.has(p.id));
	}
	if (isNobo) inStage.reverse();
	return inStage.map((p): TripBriefPoi => {
		const summary = locale === 'hr' ? (p.summary_hr ?? p.summary_en) : (p.summary_en ?? p.summary_hr);
		const thumbUrl = pickThumbUrl(p);
		return {
			id: p.id,
			name: poiDisplayName(p, locale),
			type: p.type,
			typeLabel: typeLabel(p.type),
			trailKm: p.trailKm,
			distanceFromTrailKm: p.distanceFromTrailKm,
			...(summary && { summary }),
			...(thumbUrl && { thumbUrl }),
			...(p.images?.[0]?.attribution && { attribution: p.images[0].attribution }),
			...(p.wikipedia && { wikipediaUrl: p.wikipedia }),
			...(p.resupply?.places.some((place) => place.kind === 'grocery') && { resupply: true }),
		};
	});
}

/** Returns the seasonal-status entries whose km range intersects the stage's
 *  window. The renderer can pick severity colors from these. Entries
 *  without an explicit km range (sectionId-only) are surfaced for every
 *   stage, so the user still sees the trail-wide warning. */
function collectStageAlerts(
	entries: SeasonalStatusEntry[],
	stage: { startKm: number; endKm: number },
	locale: Locale,
): TripBriefSeasonalAlert[] {
	const lo = Math.min(stage.startKm, stage.endKm);
	const hi = Math.max(stage.startKm, stage.endKm);
	return entries
		.filter((e) => {
			if (e.distanceStartKm === undefined && e.distanceEndKm === undefined) return true;
			const from = e.distanceStartKm ?? 0;
			const to = e.distanceEndKm ?? Number.POSITIVE_INFINITY;
			return !(to < lo || from > hi);
		})
		.map((e) => ({
			id: e.id,
			severity: e.severity,
			title: locale === 'hr' ? e.note_hr : e.note_en,
			fromKm: e.distanceStartKm ?? 0,
			toKm: e.distanceEndKm ?? hi,
		}));
}

// ── Misc helpers used by the assembler call sites ───────────────────────────

/** Convenience: build the localized distance-label resolver from the active
 *  units / precision settings without dragging next-intl into the assembler.
 *  The `needsConversion` flag is intentionally OFF: stage km values already
 *  arrive in kilometres, so passing `true` would divide by 1000 and render
 *  sub-km nonsense (e.g. "0.50 km" for a 500 km trail). */
export function makeDistanceLabelFn(units: UnitSystem, distancePrecision: number): (km: number) => string {
	return (km) => formatDistance(km, units, distancePrecision);
}

/** Convenience: returns true when the stage plan + trail are in a state
 *  where assembly will produce a non-empty brief. The modal uses this to
 *  enable / disable the Generate button. */
export function canAssembleTripBrief(stagePlan: StagePlan | null, trailLoaded: boolean): boolean {
	if (!trailLoaded) return false;
	if (!stagePlan) return false;
	return stagePlan.stages.length > 0;
}

/** User-edited narrative slots from the pre-export review step. */
export interface NarrativeEdits {
	overview: string;
	days: string[];
}

/** Merge edited overview and per-day narratives into a brief copy. Empty or
 *  whitespace-only edits keep the existing slot text. */
export function applyNarrativeEdits(brief: TripBrief, edits: NarrativeEdits): TripBrief {
	const overviewText = edits.overview.trim();
	const days = brief.days.map((day, i) => {
		const edited = edits.days[i]?.trim();
		return { ...day, narrative: edited && edited.length > 0 ? edited : day.narrative };
	});
	return {
		...brief,
		overview: {
			...brief.overview,
			narrative: overviewText.length > 0 ? overviewText : brief.overview.narrative,
		},
		days,
	};
}
