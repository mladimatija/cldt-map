'use client';

/** Fixed-position HUD chip showing traveled distance, distance remaining, elevation gain/loss, ETA, and "up next" data-book rows. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useStore, useMapStore, type StoreState, type MapStoreState } from '@/lib/store';
import { useBlockMapPropagation, usePackAdjustedPaceKmh, useTrailSunWeather } from '@/hooks';
import { TRAIL_OFF_TRAIL_THRESHOLD_M } from '@/lib/config';
import {
	computeDistanceRemaining,
	computeElevationRemaining,
	computeEta,
	findNearestPointIndex,
	formatEta,
} from '@/lib/distance-utils';
import { totalCompletedKm } from '@/lib/completion';
import { loadPois, poiDisplayName, poiPassesReachabilityFilter, type Poi } from '@/lib/pois';
import {
	AHEAD_HORIZON_OPTIONS,
	formatAheadHorizon,
	isAheadHorizonKm,
	isPoiInAheadCorridor,
	poiAheadKm,
	poisInAheadCorridor,
	resolveTrailAnchor,
	type AheadHorizonKm,
} from '@/lib/poi-ahead-corridor';
import { MapControlSingleSelect } from '@/components/map/controls/MapControlSelect';
import {
	mapControlSelectInlineHorizonClassNames,
	mapControlSelectInlineHorizonStyles,
} from '@/components/map/controls/map-control-select-styles';
import { isUsableWaterSource, WATER_COLOR } from '@/lib/water-intelligence';
import { hasTrailJunctions, junctionColor, junctionLabel, junctionRowKey, junctionsAhead } from '@/lib/trail-junctions';
import { poiHasResupplyKind } from '@/lib/resupply-cadence';
import { formatVolume, waterCarryLiters } from '@/lib/pack-weight';
import { formatDistance, formatElevation } from '@/lib/utils';
import { formatSunTime, isoLocalToUtcMs } from '@/lib/weather';

/** Nearest POI rows shown before the "More ahead" collapse. */
const UP_NEXT_VISIBLE_COUNT = 5;

/** Nearest marked-trail junction rows shown when the connecting-trails section is expanded. */
const JUNCTIONS_AHEAD_VISIBLE_COUNT = 8;

/** Categories shown in the up-next data-book strip. Core rows are always
 *  candidates; optional rows need a Settings toggle. Display order is by
 *  distance ahead, not category grouping. */
type UpNextKey = 'water' | 'shelter' | 'town' | 'food' | 'atm' | 'viewpoint' | 'pharmacy';

const CORE_UP_NEXT_KEYS = ['water', 'shelter', 'town'] as const satisfies readonly UpNextKey[];
const OPTIONAL_UP_NEXT_KEYS = ['food', 'atm', 'viewpoint', 'pharmacy'] as const satisfies readonly UpNextKey[];

/** POI types the up-next strip needs. Loaded directly (module-cached per
 *  type) rather than read from the store's poisFile, which only carries the
 *  currently enabled marker layers - the data-book view should answer
 *  "how far to the next water?" even with the water layer toggled off. */
const UP_NEXT_TYPES: ReadonlySet<string> = new Set([
	'water',
	'shelter',
	'hut',
	'town',
	'settlement',
	'restaurant',
	'cafe',
	'atm',
	'viewpoint',
]);

/** Marker dot colour per row; mirrors the map markers without importing the
 *  Leaflet-coupled icon builder. Water tints by reliability class. */
function upNextDotColor(key: UpNextKey, poi: Poi): string {
	if (key === 'water') return WATER_COLOR[poi.water?.reliability ?? 'unverified'];
	return `var(--poi-color-${poi.type})`;
}

/** Nearest POI ahead within the forward corridor (same anchor and horizon as the POI list). */
function nearestPoiAheadInCorridor(
	arr: Poi[],
	anchorSoboKm: number,
	horizonKm: number,
	direction: MapStoreState['direction'],
): Poi | null {
	if (direction === 'NOBO') {
		for (let i = arr.length - 1; i >= 0; i--) {
			if (isPoiInAheadCorridor(arr[i].trailKm, anchorSoboKm, horizonKm, direction)) return arr[i];
		}
		return null;
	}
	for (const p of arr) {
		if (isPoiInAheadCorridor(p.trailKm, anchorSoboKm, horizonKm, direction)) return p;
	}
	return null;
}

/** The daylight budget chip surfaces only when the projected arrival at the next
 *  place to shelter lands within this many minutes of sunset (or after it). Civil
 *  twilight buys roughly 30 min of usable light past sunset, so a sub-45-minute
 *  margin is the point worth warning about; comfortable daylight stays silent. */
const DAYLIGHT_WARN_BUFFER_MIN = 45;

/** Shape backing the daylight budget chip; the memo returns null when no warning applies. */
interface DaylightChipData {
	poi: Poi;
	etaSec: number;
	afterDark: boolean;
	marginSec: number;
	sunsetTimeStr: string;
}

/** Nearest POI ahead in the direction of travel, ignoring the up-next horizon.
 *  The daylight chip must find the next place to get out of the dark even when it
 *  lies beyond the corridor the up-next strip shows. */
function nearestPoiAheadUnbounded(
	arr: Poi[],
	anchorSoboKm: number,
	direction: MapStoreState['direction'],
): { poi: Poi; km: number } | null {
	if (direction === 'NOBO') {
		for (let i = arr.length - 1; i >= 0; i--) {
			const km = poiAheadKm(arr[i].trailKm, anchorSoboKm, direction);
			if (km !== null) return { poi: arr[i], km };
		}
		return null;
	}
	for (const poi of arr) {
		const km = poiAheadKm(poi.trailKm, anchorSoboKm, direction);
		if (km !== null) return { poi, km };
	}
	return null;
}

/** Marker types for Up Next rows currently visible in the HUD (primary rows always;
 *  overflow rows only when the "More ahead" block is expanded). */
function upNextDisplayedPoiTypes(
	primaryRows: ReadonlyArray<{ poi: Poi }>,
	moreRows: ReadonlyArray<{ poi: Poi }>,
	moreExpanded: boolean,
): Set<string> {
	const types = new Set<string>();
	for (const { poi } of primaryRows) types.add(poi.type);
	if (moreExpanded) {
		for (const { poi } of moreRows) types.add(poi.type);
	}
	return types;
}

export function DistanceRemainingOverlay(): React.ReactElement | null {
	const overlayRef = useRef<HTMLDivElement>(null);
	useBlockMapPropagation(overlayRef);

	const t = useTranslations('distanceOverlay');
	const tPois = useTranslations('pois');
	const tJunctions = useTranslations('trailJunctions');

	function etaAriaLabel(seconds: number): string {
		const totalMinutes = Math.round(seconds / 60);
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		const approx = t('approximately');
		if (hours === 0) return `${approx} ${t('etaAriaMinute', { count: minutes })}`;
		if (minutes === 0) return `${approx} ${t('etaAriaHour', { count: hours })}`;
		return `${approx} ${t('etaAriaHour', { count: hours })} ${t('etaAriaMinute', { count: minutes })}`;
	}
	const closestPoint = useStore((state: StoreState) => state.closestPoint);
	const enhancedTrailPoints = useStore((state: StoreState) => state.enhancedTrailPoints);
	const rulerRange = useMapStore((state: MapStoreState) => state.rulerRange);
	const units = useMapStore((state: MapStoreState) => state.units);
	const direction = useMapStore((state: MapStoreState) => state.direction);
	const walkingPaceKmh = usePackAdjustedPaceKmh();
	const gradeAdjustedEta = useMapStore((state: MapStoreState) => state.gradeAdjustedEta);
	const distancePrecision = useMapStore((state: MapStoreState) => state.distancePrecision);
	const showUpNext = useMapStore((state: MapStoreState) => state.showUpNext);
	const upNextShowFood = useMapStore((state: MapStoreState) => state.upNextShowFood);
	const upNextShowAtm = useMapStore((state: MapStoreState) => state.upNextShowAtm);
	const upNextShowViewpoint = useMapStore((state: MapStoreState) => state.upNextShowViewpoint);
	const upNextShowPharmacy = useMapStore((state: MapStoreState) => state.upNextShowPharmacy);
	const upNextMoreExpanded = useMapStore((state: MapStoreState) => state.upNextMoreExpanded);
	const setUpNextMoreExpanded = useMapStore((state: MapStoreState) => state.setUpNextMoreExpanded);
	const trailJunctionsFile = useMapStore((state: MapStoreState) => state.trailJunctionsFile);
	const junctionsAheadExpanded = useMapStore((state: MapStoreState) => state.junctionsAheadExpanded);
	const setJunctionsAheadExpanded = useMapStore((state: MapStoreState) => state.setJunctionsAheadExpanded);
	const packBaseWeightKg = useMapStore((state: MapStoreState) => state.packBaseWeightKg);
	const waterConsumptionLph = useMapStore((state: MapStoreState) => state.waterConsumptionLph);
	const enabledPoiTypes = useMapStore((state: MapStoreState) => state.enabledPoiTypes);
	const enabledPoiTags = useMapStore((state: MapStoreState) => state.enabledPoiTags);
	const includeRemotePois = useMapStore((state: MapStoreState) => state.includeRemotePois);
	const poisFile = useMapStore((state: MapStoreState) => state.poisFile);
	const aheadHorizonKm = useMapStore((state: MapStoreState) => state.aheadHorizonKm);
	const setAheadHorizonKm = useMapStore((state: MapStoreState) => state.setAheadHorizonKm);
	const requestPoiListAhead = useMapStore((state: MapStoreState) => state.requestPoiListAhead);
	const setEnabledPoiTypes = useMapStore((state: MapStoreState) => state.setEnabledPoiTypes);
	const togglePoiType = useMapStore((state: MapStoreState) => state.togglePoiType);
	const poisLayerEnabled = useMapStore((state: MapStoreState) => state.poisLayerEnabled);
	const setPoisLayerEnabled = useMapStore((state: MapStoreState) => state.setPoisLayerEnabled);
	const requestOpenPoi = useMapStore((state: MapStoreState) => state.requestOpenPoi);
	const locale = useLocale();

	// Daylight data for the daylight-budget chip; shared with the sunset markers.
	const sunWeather = useTrailSunWeather(true);

	// Up-next dataset, independent of which marker layers are enabled. Loaded when
	// the up-next strip is shown OR the hiker is on-trail, since the daylight chip
	// needs the shelter/town data even with the up-next strip toggled off (the
	// loadPois call is module-cached, so the extra trigger costs nothing once warm).
	const [upNextPois, setUpNextPois] = useState<Poi[]>([]);
	useEffect(() => {
		if (!showUpNext && !sunWeather.isOnTrail) return;
		let cancelled = false;
		void loadPois(UP_NEXT_TYPES).then((file) => {
			if (!cancelled && file) setUpNextPois(file.pois);
		});
		return () => {
			cancelled = true;
		};
	}, [showUpNext, sunWeather.isOnTrail]);

	// Per-category km-sorted indexes; rebuilt only when the dataset changes.
	const upNextIndex = useMemo(() => {
		const byKm = (a: Poi, b: Poi): number => a.trailKm - b.trailKm;
		const reachable = upNextPois.filter((p) => poiPassesReachabilityFilter(p, includeRemotePois));
		return {
			water: reachable.filter((p) => p.type === 'water' && isUsableWaterSource(p.water)).sort(byKm),
			shelter: reachable.filter((p) => p.type === 'shelter' || p.type === 'hut').sort(byKm),
			town: reachable.filter((p) => p.type === 'town' || p.type === 'settlement').sort(byKm),
			food: reachable.filter((p) => p.type === 'restaurant' || p.type === 'cafe').sort(byKm),
			atm: reachable.filter((p) => p.type === 'atm').sort(byKm),
			viewpoint: reachable.filter((p) => p.type === 'viewpoint').sort(byKm),
			pharmacy: reachable.filter((p) => poiHasResupplyKind(p, 'pharmacy')).sort(byKm),
		};
	}, [upNextPois, includeRemotePois]);

	const trailAnchor = useMemo(
		() => resolveTrailAnchor(closestPoint, rulerRange, TRAIL_OFF_TRAIL_THRESHOLD_M),
		[closestPoint, rulerRange],
	);

	// Nearest POI ahead in the direction of travel for each enabled category,
	// sorted by distance and split into the visible strip vs "More ahead".
	const { primaryUpNextRows, moreUpNextRows } = useMemo(() => {
		const empty = {
			primaryUpNextRows: [] as { key: UpNextKey; poi: Poi; km: number }[],
			moreUpNextRows: [] as { key: UpNextKey; poi: Poi; km: number }[],
		};
		if (!showUpNext || trailAnchor === null) return empty;
		const anchorSoboKm = trailAnchor.soboKm;
		const buildRow = (key: UpNextKey): { key: UpNextKey; poi: Poi; km: number } | null => {
			const poi = nearestPoiAheadInCorridor(upNextIndex[key], anchorSoboKm, aheadHorizonKm, direction);
			if (!poi) return null;
			const km = poiAheadKm(poi.trailKm, anchorSoboKm, direction);
			if (km === null) return null;
			return { key, poi, km };
		};
		const enabledKeys: UpNextKey[] = [
			...CORE_UP_NEXT_KEYS,
			...OPTIONAL_UP_NEXT_KEYS.filter((key) => {
				if (key === 'food') return upNextShowFood;
				if (key === 'atm') return upNextShowAtm;
				if (key === 'viewpoint') return upNextShowViewpoint;
				return upNextShowPharmacy;
			}),
		];
		const sortedRows = enabledKeys
			.map(buildRow)
			.filter((row): row is NonNullable<typeof row> => row !== null)
			.sort((a, b) => a.km - b.km);
		return {
			primaryUpNextRows: sortedRows.slice(0, UP_NEXT_VISIBLE_COUNT),
			moreUpNextRows: sortedRows.slice(UP_NEXT_VISIBLE_COUNT),
		};
	}, [
		showUpNext,
		trailAnchor,
		aheadHorizonKm,
		direction,
		upNextIndex,
		upNextShowFood,
		upNextShowAtm,
		upNextShowViewpoint,
		upNextShowPharmacy,
	]);

	const aheadCorridorCount = useMemo((): number => {
		if (!trailAnchor || !poisFile?.pois?.length) return 0;
		return poisInAheadCorridor({
			pois: poisFile.pois,
			anchorSoboKm: trailAnchor.soboKm,
			horizonKm: aheadHorizonKm,
			direction,
			enabledPoiTypes,
			enabledPoiTags,
			includeRemotePois,
		}).length;
	}, [trailAnchor, poisFile, aheadHorizonKm, direction, enabledPoiTypes, enabledPoiTags, includeRemotePois]);

	/** Marked-trail junctions (OSM route relations branching off the CLDT) ahead
	 *  within the same forward corridor as Up Next. Empty until junction data is
	 *  enriched, so the whole section stays hidden while the feature is dormant. */
	const junctionsAheadList = useMemo(() => {
		if (!trailAnchor || !hasTrailJunctions(trailJunctionsFile)) return [];
		return junctionsAhead(trailJunctionsFile.junctions, trailAnchor.soboKm, aheadHorizonKm, direction);
	}, [trailAnchor, trailJunctionsFile, aheadHorizonKm, direction]);

	/** Open the POI popup; if its marker layer is toggled off, enable the
	 *  layer first so the pending-open request has a marker to land on. */
	const handleUpNextClick = (poi: Poi): void => {
		if (!enabledPoiTypes.has(poi.type)) togglePoiType(poi.type);
		requestOpenPoi(poi.id);
	};

	/** Open the ahead-sorted POI list and enable filters for types shown in Up Next. */
	const handleSeeAllAhead = (): void => {
		// Turn on the "Show on map" POI layer so the ahead POIs are actually
		// rendered as markers, not just listed (markers are gated on this flag).
		if (!poisLayerEnabled) setPoisLayerEnabled(true);
		const displayedTypes = upNextDisplayedPoiTypes(primaryUpNextRows, moreUpNextRows, upNextMoreExpanded);
		let needsUpdate = false;
		const merged = new Set(enabledPoiTypes);
		for (const type of displayedTypes) {
			if (!merged.has(type)) {
				merged.add(type);
				needsUpdate = true;
			}
		}
		if (needsUpdate) setEnabledPoiTypes(merged);
		requestPoiListAhead();
	};

	const upNextAriaLabel: Record<UpNextKey, string> = {
		water: t('upNextWater'),
		shelter: t('upNextShelter'),
		town: t('upNextTown'),
		food: t('upNextFood'),
		atm: t('upNextAtm'),
		viewpoint: t('upNextViewpoint'),
		pharmacy: t('upNextPharmacy'),
	};

	const renderUpNextRow = ({ key, poi, km }: { key: UpNextKey; poi: Poi; km: number }): React.ReactElement => {
		const carryL =
			key === 'water' && packBaseWeightKg !== null ? waterCarryLiters(km, walkingPaceKmh, waterConsumptionLph) : 0;
		const carryStr = carryL > 0 ? formatVolume(carryL, units) : null;
		const displayName = poiDisplayName(poi, locale);
		const typeLabel = tPois(`type.${poi.type}`, { default: poi.type });
		const poiTooltip = `${displayName} · ${typeLabel}`;
		return (
			<button
				aria-label={`${upNextAriaLabel[key]}: ${poiTooltip}, ${formatDistance(km, units, distancePrecision)}${carryStr ? `, ${carryStr}` : ''}`}
				className="flex w-full cursor-pointer items-center justify-between gap-3 rounded text-left hover:bg-gray-100 dark:hover:bg-[var(--bg-primary)]"
				key={key}
				title={poiTooltip}
				type="button"
				onClick={() => handleUpNextClick(poi)}
			>
				<span className="flex min-w-0 items-center gap-1.5 text-gray-500 dark:text-[var(--text-secondary)]">
					<span
						aria-hidden="true"
						className="size-2 shrink-0 rounded-full"
						style={{ backgroundColor: upNextDotColor(key, poi) }}
					/>
					<span className="max-w-[9rem] truncate">{displayName}</span>
				</span>
				<span className="shrink-0">
					{formatDistance(km, units, distancePrecision)}
					{carryStr && (
						<span aria-hidden="true" className="ml-1 text-[0.625rem] text-gray-400 dark:text-[var(--text-secondary)]">
							≈{carryStr}
						</span>
					)}
				</span>
			</button>
		);
	};

	// Without useMemo, computeDistanceRemaining returns a new object literal on every render,
	// causing the downstream ETA useMemo to fire unnecessarily.
	const distanceInfo = useMemo(
		() => computeDistanceRemaining(closestPoint, rulerRange, TRAIL_OFF_TRAIL_THRESHOLD_M),
		[closestPoint, rulerRange],
	);

	// Memoize the nearest-index lookup - only recomputes when the user's snapped position or
	// the trail array changes, not on every unrelated render.
	const fromIndex = useMemo(
		() => findNearestPointIndex(enhancedTrailPoints, closestPoint?.distanceFromStart ?? 0),
		[enhancedTrailPoints, closestPoint?.distanceFromStart],
	);

	const elevInfo = useMemo(
		() =>
			enhancedTrailPoints.length > 0
				? computeElevationRemaining(enhancedTrailPoints, fromIndex, direction, rulerRange, enhancedTrailPoints)
				: null,
		[enhancedTrailPoints, fromIndex, direction, rulerRange],
	);

	/** Personal completion progress; 0 hides the row (pre-feature look). */
	const completedIntervals = useMapStore((s: MapStoreState) => s.completedIntervals);
	const hikedKm = useMemo(() => totalCompletedKm(completedIntervals), [completedIntervals]);

	const { etaToEndSeconds, etaToSectionSeconds } = useMemo(() => {
		if (distanceInfo === null) return { etaToEndSeconds: 0, etaToSectionSeconds: null };
		const etaOpts = { elevationPoints: enhancedTrailPoints, fromIndex, direction, gradeAdjusted: gradeAdjustedEta };
		return {
			etaToEndSeconds: computeEta(distanceInfo.toTrailEnd, walkingPaceKmh, etaOpts),
			etaToSectionSeconds:
				distanceInfo.toSectionEnd !== null ? computeEta(distanceInfo.toSectionEnd, walkingPaceKmh, etaOpts) : null,
		};
	}, [distanceInfo, enhancedTrailPoints, fromIndex, direction, gradeAdjustedEta, walkingPaceKmh]);

	/** Daylight budget: can the hiker reach the next place to shelter before dark?
	 *  Cross-references the fetched sunset time against the projected arrival at the
	 *  nearest hut/shelter or town ahead. Null (no chip) when off-trail, after
	 *  sunset, with no place ahead, or when there is comfortable daylight to spare. */
	const daylight = useMemo((): DaylightChipData | null => {
		const w = sunWeather.weatherData;
		if (!w?.sunset || closestPoint === null || enhancedTrailPoints.length < 2) return null;
		const sunsetMs = isoLocalToUtcMs(w.sunset, w.utcOffsetSeconds);
		if (!Number.isFinite(sunsetMs)) return null; // guard a malformed sunset string from the weather API
		if (sunsetMs <= sunWeather.nowMs) return null; // already past sunset - not a "racing the dark" case
		const anchorSoboKm = closestPoint.distanceFromStart / 1000;
		const candidates = [
			nearestPoiAheadUnbounded(upNextIndex.shelter, anchorSoboKm, direction),
			nearestPoiAheadUnbounded(upNextIndex.town, anchorSoboKm, direction),
		].filter((c): c is { poi: Poi; km: number } => c !== null);
		if (candidates.length === 0) return null;
		const nearest = candidates.reduce((best, c) => (c.km < best.km ? c : best));
		const etaOpts = { elevationPoints: enhancedTrailPoints, fromIndex, direction, gradeAdjusted: gradeAdjustedEta };
		const etaSec = computeEta(nearest.km * 1000, walkingPaceKmh, etaOpts);
		const marginMin = (sunsetMs - (sunWeather.nowMs + etaSec * 1000)) / 60_000;
		if (marginMin > DAYLIGHT_WARN_BUFFER_MIN) return null; // comfortable daylight - stay out of the way
		return {
			poi: nearest.poi,
			etaSec,
			afterDark: marginMin < 0,
			marginSec: Math.abs(Math.round(marginMin * 60)),
			sunsetTimeStr: formatSunTime(w.sunset, units),
		};
	}, [
		sunWeather.weatherData,
		sunWeather.nowMs,
		closestPoint,
		enhancedTrailPoints,
		upNextIndex,
		direction,
		fromIndex,
		gradeAdjustedEta,
		walkingPaceKmh,
		units,
	]);

	const renderDaylightChip = (d: DaylightChipData): React.ReactElement => {
		const colorClass = d.afterDark ? 'text-cldt-red' : 'text-amber-700 dark:text-amber-400';
		const placeName = poiDisplayName(d.poi, locale);
		const marginText = d.afterDark
			? t('daylightAfterDark', { eta: formatEta(d.marginSec) })
			: t('daylightBeforeDark', { eta: formatEta(d.marginSec) });
		return (
			<div className="mt-1 border-t border-gray-200 pt-1 dark:border-[var(--border-color)]">
				<span className="sr-only">
					{t('daylightAria', {
						place: placeName,
						eta: formatEta(d.etaSec),
						time: d.sunsetTimeStr,
						margin: marginText,
					})}
				</span>
				<div aria-hidden="true" className={`flex justify-between gap-4 ${colorClass}`}>
					<span className="min-w-0 truncate" title={placeName}>
						{placeName}
					</span>
					<span className="shrink-0">{formatEta(d.etaSec)}</span>
				</div>
				<div aria-hidden="true" className={`text-[0.625rem] ${colorClass}`}>
					{t('daylightSunset', { time: d.sunsetTimeStr })} · {marginText}
				</div>
			</div>
		);
	};

	const aheadHorizonOptions = useMemo(
		() =>
			AHEAD_HORIZON_OPTIONS.map((km) => ({
				value: km,
				label: formatAheadHorizon(km, units, distancePrecision),
			})),
		[units, distancePrecision],
	);
	const selectedAheadHorizonOption = useMemo(
		() => aheadHorizonOptions.find((o) => o.value === aheadHorizonKm) ?? aheadHorizonOptions[1],
		[aheadHorizonOptions, aheadHorizonKm],
	);

	/** Leaflet blocks pointer down before it reaches React's root listener, so react-select
	 *  never sees control clicks inside useBlockMapPropagation overlays. Toggle the menu
	 *  natively and portal it to document.body so option clicks stay interactive. */
	const horizonSelectWrapRef = useRef<HTMLSpanElement>(null);
	const [horizonMenuOpen, setHorizonMenuOpen] = useState(false);
	useEffect(() => {
		const wrap = horizonSelectWrapRef.current;
		if (!wrap) return;
		const onControlPointerDown = (e: MouseEvent | TouchEvent): void => {
			if (!(e.target as Element).closest('.map-control-select__control')) return;
			e.stopPropagation();
			setHorizonMenuOpen((open) => !open);
		};
		wrap.addEventListener('mousedown', onControlPointerDown);
		wrap.addEventListener('touchstart', onControlPointerDown, { passive: true });
		return () => {
			wrap.removeEventListener('mousedown', onControlPointerDown);
			wrap.removeEventListener('touchstart', onControlPointerDown);
		};
	}, []);

	if (distanceInfo === null) return null;

	const anyOptionalUpNextEnabled = upNextShowFood || upNextShowAtm || upNextShowViewpoint || upNextShowPharmacy;
	const hasUpNextContent =
		showUpNext && (primaryUpNextRows.length > 0 || moreUpNextRows.length > 0 || anyOptionalUpNextEnabled);

	return (
		<div
			className="z-controls absolute top-2 right-14 flex min-w-[10rem] flex-col gap-0.5 rounded-lg bg-white/90 px-3 py-2 text-xs font-medium text-gray-800 shadow dark:bg-[var(--bg-secondary)]/90 dark:text-[var(--text-primary)]"
			ref={overlayRef}
			role="status"
		>
			<div className="flex justify-between gap-4">
				<span className="text-gray-500 dark:text-[var(--text-secondary)]">{t('traveled')}</span>
				<span>{formatDistance(distanceInfo.traveled, units, distancePrecision, true)}</span>
			</div>
			{hikedKm > 0 && (
				<div className="flex justify-between gap-4">
					<span className="text-gray-500 dark:text-[var(--text-secondary)]">{t('hiked')}</span>
					<span>{formatDistance(hikedKm, units, distancePrecision)}</span>
				</div>
			)}
			<div className="flex justify-between gap-4">
				<span className="text-gray-500 dark:text-[var(--text-secondary)]">{t('toTrailEnd')}</span>
				<span>{formatDistance(distanceInfo.toTrailEnd, units, distancePrecision, true)}</span>
			</div>
			{distanceInfo.toSectionEnd !== null && (
				<div className="flex justify-between gap-4">
					<span className="text-gray-500 dark:text-[var(--text-secondary)]">{t('toSectionEnd')}</span>
					<span>{formatDistance(distanceInfo.toSectionEnd, units, distancePrecision, true)}</span>
				</div>
			)}
			{elevInfo !== null && (
				<div className="mt-1 border-t border-gray-200 pt-1 dark:border-[var(--border-color)]">
					<div className="flex justify-between gap-4">
						<span className="text-gray-500 dark:text-[var(--text-secondary)]">
							<span aria-hidden="true">↑ </span>
							{t('elevGain')}
						</span>
						<span>{formatElevation(elevInfo.gainM, units)}</span>
					</div>
					<div className="flex justify-between gap-4">
						<span className="text-gray-500 dark:text-[var(--text-secondary)]">
							<span aria-hidden="true">↓ </span>
							{t('elevLoss')}
						</span>
						<span>{formatElevation(elevInfo.lossM, units)}</span>
					</div>
					{elevInfo.sectionGainM !== null && (
						<div className="flex justify-between gap-4">
							<span className="text-gray-500 dark:text-[var(--text-secondary)]">
								<span aria-hidden="true">↑ </span>
								{t('elevGainSection')}
							</span>
							<span>{formatElevation(elevInfo.sectionGainM, units)}</span>
						</div>
					)}
					{elevInfo.sectionLossM !== null && (
						<div className="flex justify-between gap-4">
							<span className="text-gray-500 dark:text-[var(--text-secondary)]">
								<span aria-hidden="true">↓ </span>
								{t('elevLossSection')}
							</span>
							<span>{formatElevation(elevInfo.sectionLossM, units)}</span>
						</div>
					)}
				</div>
			)}
			<div className="mt-1 border-t border-gray-200 pt-1 dark:border-[var(--border-color)]">
				<div className="flex justify-between gap-4">
					<span className="text-gray-500 dark:text-[var(--text-secondary)]">{t('etaToEnd')}</span>
					<span aria-label={etaAriaLabel(etaToEndSeconds)}>{formatEta(etaToEndSeconds)}</span>
				</div>
				{etaToSectionSeconds !== null && (
					<div className="flex justify-between gap-4">
						<span className="text-gray-500 dark:text-[var(--text-secondary)]">{t('etaToSection')}</span>
						<span aria-label={etaAriaLabel(etaToSectionSeconds)}>{formatEta(etaToSectionSeconds)}</span>
					</div>
				)}
			</div>
			{daylight && renderDaylightChip(daylight)}
			{hasUpNextContent && (
				<div className="mt-1 border-t border-gray-200 pt-1 dark:border-[var(--border-color)]">
					<div className="m-0 text-[0.625rem] font-medium tracking-wide text-gray-400 dark:text-[var(--text-secondary)]">
						<span className="uppercase">{t('upNext')}</span>{' '}
						<span className="inline-flex normal-case" ref={horizonSelectWrapRef}>
							<MapControlSingleSelect<{ value: AheadHorizonKm; label: string }>
								aria-label={t('upNextHorizonAriaLabel', {
									distance: formatAheadHorizon(aheadHorizonKm, units, distancePrecision),
								})}
								classNames={mapControlSelectInlineHorizonClassNames}
								menuIsOpen={horizonMenuOpen}
								menuPortalTarget={typeof document === 'undefined' ? null : document.body}
								options={aheadHorizonOptions}
								styles={mapControlSelectInlineHorizonStyles}
								value={selectedAheadHorizonOption}
								onChange={(option) => {
									if (option && isAheadHorizonKm(option.value)) {
										setAheadHorizonKm(option.value);
										setHorizonMenuOpen(false);
									}
								}}
								onMenuClose={() => setHorizonMenuOpen(false)}
								onMenuOpen={() => setHorizonMenuOpen(true)}
							/>
						</span>
					</div>
					{primaryUpNextRows.map(renderUpNextRow)}
					{moreUpNextRows.length > 0 && (
						<div className="mt-0.5">
							<button
								aria-expanded={upNextMoreExpanded}
								className="text-cldt-blue flex w-full cursor-pointer items-center gap-1 rounded text-left text-[0.625rem] hover:underline focus-visible:underline focus-visible:outline-none dark:text-[var(--text-primary)]"
								type="button"
								onClick={() => setUpNextMoreExpanded(!upNextMoreExpanded)}
							>
								<span aria-hidden="true">{upNextMoreExpanded ? '▾' : '▸'}</span>
								{t('upNextMoreAhead')}
							</button>
							{upNextMoreExpanded && moreUpNextRows.map(renderUpNextRow)}
						</div>
					)}
					{aheadCorridorCount > 0 && (
						<button
							className="text-cldt-blue mt-1 w-full cursor-pointer rounded text-left text-[0.625rem] hover:underline focus-visible:underline focus-visible:outline-none dark:text-[var(--text-primary)]"
							type="button"
							onClick={handleSeeAllAhead}
						>
							{t('upNextSeeAll', { count: aheadCorridorCount })}
						</button>
					)}
				</div>
			)}
			{junctionsAheadList.length > 0 && (
				<div className="mt-1 border-t border-gray-200 pt-1 dark:border-[var(--border-color)]">
					<button
						aria-expanded={junctionsAheadExpanded}
						className="flex w-full cursor-pointer items-center gap-1 rounded text-left text-[0.625rem] font-medium tracking-wide text-gray-400 hover:text-gray-600 focus-visible:underline focus-visible:outline-none dark:text-[var(--text-secondary)] dark:hover:text-[var(--text-primary)]"
						type="button"
						onClick={() => setJunctionsAheadExpanded(!junctionsAheadExpanded)}
					>
						<span aria-hidden="true">{junctionsAheadExpanded ? '▾' : '▸'}</span>
						<span className="uppercase">{tJunctions('sectionTitle')}</span>
						<span className="normal-case">({junctionsAheadList.length})</span>
					</button>
					{junctionsAheadExpanded && (
						<div className="mt-0.5 flex flex-col gap-0.5">
							{junctionsAheadList.slice(0, JUNCTIONS_AHEAD_VISIBLE_COUNT).map(({ junction, aheadKm }) => {
								const label = junctionLabel(junction, tJunctions('layerLabel'));
								return (
									<div className="flex items-center justify-between gap-3" key={junctionRowKey(junction)}>
										<span className="flex min-w-0 items-center gap-1.5 text-gray-500 dark:text-[var(--text-secondary)]">
											<span
												aria-hidden="true"
												className="size-2 shrink-0 rounded-full"
												style={{ backgroundColor: junctionColor(junction) }}
											/>
											<span className="max-w-[9rem] truncate" title={label}>
												{label}
											</span>
										</span>
										<span className="shrink-0">{formatDistance(aheadKm, units, distancePrecision)}</span>
									</div>
								);
							})}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
