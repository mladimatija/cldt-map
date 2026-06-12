'use client';

/** Fixed-position HUD chip showing traveled distance, distance remaining, elevation gain/loss, ETA, and "up next" data-book rows. */
import React, { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useStore, useMapStore, type StoreState, type MapStoreState } from '@/lib/store';
import { usePackAdjustedPaceKmh } from '@/hooks';
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
import { poisInAheadCorridor, resolveTrailAnchor } from '@/lib/poi-ahead-corridor';
import { isUsableWaterSource, WATER_COLOR } from '@/lib/water-intelligence';
import { formatVolume, waterCarryLiters } from '@/lib/pack-weight';
import { formatDistance, formatElevation } from '@/lib/utils';

/** Categories shown in the up-next data-book strip, in render order. */
type UpNextKey = 'water' | 'shelter' | 'town';

/** POI types the up-next strip needs. Loaded directly (module-cached per
 *  type) rather than read from the store's poisFile, which only carries the
 *  currently enabled marker layers - the data-book view should answer
 *  "how far to the next water?" even with the water layer toggled off. */
const UP_NEXT_TYPES: ReadonlySet<string> = new Set(['water', 'shelter', 'hut', 'town', 'settlement']);

/** Marker dot colour per row; mirrors the map markers without importing the
 *  Leaflet-coupled icon builder. Water tints by reliability class. */
function upNextDotColor(key: UpNextKey, poi: Poi): string {
	if (key === 'water') return WATER_COLOR[poi.water?.reliability ?? 'unverified'];
	return `var(--poi-color-${poi.type})`;
}

export function DistanceRemainingOverlay(): React.ReactElement | null {
	const t = useTranslations('distanceOverlay');

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
	const packBaseWeightKg = useMapStore((state: MapStoreState) => state.packBaseWeightKg);
	const waterConsumptionLph = useMapStore((state: MapStoreState) => state.waterConsumptionLph);
	const enabledPoiTypes = useMapStore((state: MapStoreState) => state.enabledPoiTypes);
	const enabledPoiTags = useMapStore((state: MapStoreState) => state.enabledPoiTags);
	const includeRemotePois = useMapStore((state: MapStoreState) => state.includeRemotePois);
	const poisFile = useMapStore((state: MapStoreState) => state.poisFile);
	const aheadHorizonKm = useMapStore((state: MapStoreState) => state.aheadHorizonKm);
	const requestPoiListAhead = useMapStore((state: MapStoreState) => state.requestPoiListAhead);
	const togglePoiType = useMapStore((state: MapStoreState) => state.togglePoiType);
	const requestOpenPoi = useMapStore((state: MapStoreState) => state.requestOpenPoi);
	const locale = useLocale();

	// Up-next dataset, independent of which marker layers are enabled.
	const [upNextPois, setUpNextPois] = useState<Poi[]>([]);
	useEffect(() => {
		if (!showUpNext) return;
		let cancelled = false;
		void loadPois(UP_NEXT_TYPES).then((file) => {
			if (!cancelled && file) setUpNextPois(file.pois);
		});
		return () => {
			cancelled = true;
		};
	}, [showUpNext]);

	// Per-category km-sorted indexes; rebuilt only when the dataset changes.
	const upNextIndex = useMemo(() => {
		const byKm = (a: Poi, b: Poi): number => a.trailKm - b.trailKm;
		const reachable = upNextPois.filter((p) => poiPassesReachabilityFilter(p, includeRemotePois));
		return {
			water: reachable.filter((p) => p.type === 'water' && isUsableWaterSource(p.water)).sort(byKm),
			shelter: reachable.filter((p) => p.type === 'shelter' || p.type === 'hut').sort(byKm),
			town: reachable.filter((p) => p.type === 'town' || p.type === 'settlement').sort(byKm),
		};
	}, [upNextPois, includeRemotePois]);

	// Nearest POI ahead in the direction of travel for each category.
	// trailKm is measured SOBO from the northern trailhead, matching
	// closestPoint.distanceFromStart, so "ahead" is larger km when walking
	// SOBO and smaller km when walking NOBO.
	const upNextRows = useMemo(() => {
		if (!showUpNext || closestPoint === null) return [];
		const curKm = closestPoint.distanceFromStart / 1000;
		const ahead = (arr: Poi[]): Poi | null => {
			if (direction === 'NOBO') {
				for (let i = arr.length - 1; i >= 0; i--) if (arr[i].trailKm < curKm) return arr[i];
				return null;
			}
			for (const p of arr) if (p.trailKm > curKm) return p;
			return null;
		};
		const rows: { key: UpNextKey; poi: Poi; km: number }[] = [];
		for (const key of ['water', 'shelter', 'town'] as const) {
			const poi = ahead(upNextIndex[key]);
			if (poi) rows.push({ key, poi, km: Math.abs(poi.trailKm - curKm) });
		}
		return rows;
	}, [showUpNext, closestPoint, direction, upNextIndex]);

	const trailAnchor = useMemo(
		() => resolveTrailAnchor(closestPoint, rulerRange, TRAIL_OFF_TRAIL_THRESHOLD_M),
		[closestPoint, rulerRange],
	);

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

	/** Open the POI popup; if its marker layer is toggled off, enable the
	 *  layer first so the pending-open request has a marker to land on. */
	const handleUpNextClick = (poi: Poi): void => {
		if (!enabledPoiTypes.has(poi.type)) togglePoiType(poi.type);
		requestOpenPoi(poi.id);
	};

	const upNextAriaLabel: Record<UpNextKey, string> = {
		water: t('upNextWater'),
		shelter: t('upNextShelter'),
		town: t('upNextTown'),
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

	if (distanceInfo === null) return null;

	return (
		<div
			className="z-controls absolute top-2 right-14 flex min-w-[10rem] flex-col gap-0.5 rounded-lg bg-white/90 px-3 py-2 text-xs font-medium text-gray-800 shadow dark:bg-[var(--bg-secondary)]/90 dark:text-[var(--text-primary)]"
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
			{upNextRows.length > 0 && (
				<div className="mt-1 border-t border-gray-200 pt-1 dark:border-[var(--border-color)]">
					<p className="m-0 text-[10px] font-medium tracking-wide text-gray-400 uppercase dark:text-gray-500">
						{t('upNext')}
					</p>
					{upNextRows.map(({ key, poi, km }) => {
						// Water-to-carry hint: liters to reach the next source at the
						// (pack-adjusted) pace; only when the pack feature is on.
						const carryL =
							key === 'water' && packBaseWeightKg !== null
								? waterCarryLiters(km, walkingPaceKmh, waterConsumptionLph)
								: 0;
						const carryStr = carryL > 0 ? formatVolume(carryL, units) : null;
						return (
							<button
								aria-label={`${upNextAriaLabel[key]}: ${poiDisplayName(poi, locale)}, ${formatDistance(km, units, distancePrecision)}${carryStr ? `, ${carryStr}` : ''}`}
								className="flex w-full cursor-pointer items-center justify-between gap-3 rounded text-left hover:bg-gray-100 dark:hover:bg-[var(--bg-primary)]"
								key={key}
								type="button"
								onClick={() => handleUpNextClick(poi)}
							>
								<span className="flex min-w-0 items-center gap-1.5 text-gray-500 dark:text-[var(--text-secondary)]">
									<span
										aria-hidden="true"
										className="size-2 shrink-0 rounded-full"
										style={{ backgroundColor: upNextDotColor(key, poi) }}
									/>
									<span className="max-w-[9rem] truncate">{poiDisplayName(poi, locale)}</span>
								</span>
								<span className="shrink-0">
									{formatDistance(km, units, distancePrecision)}
									{carryStr && (
										<span aria-hidden="true" className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">
											≈{carryStr}
										</span>
									)}
								</span>
							</button>
						);
					})}
					{aheadCorridorCount > 0 && (
						<button
							className="text-cldt-blue mt-1 w-full cursor-pointer rounded text-left text-[10px] hover:underline focus-visible:underline focus-visible:outline-none dark:text-[var(--text-primary)]"
							type="button"
							onClick={() => requestPoiListAhead()}
						>
							{t('upNextSeeAll', { count: aheadCorridorCount })}
						</button>
					)}
				</div>
			)}
		</div>
	);
}
