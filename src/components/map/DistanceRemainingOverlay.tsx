'use client';

/** Fixed-position HUD chip showing traveled distance, distance remaining, elevation gain/loss, and ETA rows. */
import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useStore, useMapStore, type StoreState, type MapStoreState } from '@/lib/store';
import { TRAIL_OFF_TRAIL_THRESHOLD_M } from '@/lib/config';
import {
	computeDistanceRemaining,
	computeElevationRemaining,
	computeEta,
	findNearestPointIndex,
	formatEta,
} from '@/lib/distance-utils';
import { totalCompletedKm } from '@/lib/completion';
import { formatDistance, formatElevation } from '@/lib/utils';

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
	const walkingPaceKmh = useMapStore((state: MapStoreState) => state.walkingPaceKmh);
	const gradeAdjustedEta = useMapStore((state: MapStoreState) => state.gradeAdjustedEta);
	const distancePrecision = useMapStore((state: MapStoreState) => state.distancePrecision);

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
		</div>
	);
}
