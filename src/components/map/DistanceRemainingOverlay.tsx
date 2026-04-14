'use client';

/** Fixed-position HUD chip showing traveled distance, distance remaining, elevation gain/loss, and ETA rows. */
import React from 'react';
import { useTranslations } from 'next-intl';
import { useStore, useMapStore, type StoreState, type MapStoreState } from '@/lib/store';
import { TRAIL_OFF_TRAIL_THRESHOLD_M } from '@/lib/config';
import { computeDistanceRemaining, computeElevationRemaining, computeEta, formatEta } from '@/lib/distance-utils';
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
	const gpxElevationPoints = useStore((state: StoreState) => state.gpxElevationPoints);
	const enhancedTrailPoints = useStore((state: StoreState) => state.enhancedTrailPoints);
	const rulerRange = useMapStore((state: MapStoreState) => state.rulerRange);
	const units = useMapStore((state: MapStoreState) => state.units);
	const direction = useMapStore((state: MapStoreState) => state.direction);
	const walkingPaceKmh = useMapStore((state: MapStoreState) => state.walkingPaceKmh);
	const distancePrecision = useMapStore((state: MapStoreState) => state.distancePrecision);

	const distanceInfo = computeDistanceRemaining(closestPoint, rulerRange, TRAIL_OFF_TRAIL_THRESHOLD_M);

	if (distanceInfo === null) return null;

	// Find the index in enhancedTrailPoints nearest to closestPoint.distanceFromStart
	let fromIndex = 0;
	if (closestPoint !== null && enhancedTrailPoints.length > 0) {
		let minDiff = Math.abs(enhancedTrailPoints[0].distanceFromStart - closestPoint.distanceFromStart);
		for (let i = 1; i < enhancedTrailPoints.length; i++) {
			const diff = Math.abs(enhancedTrailPoints[i].distanceFromStart - closestPoint.distanceFromStart);
			if (diff < minDiff) {
				minDiff = diff;
				fromIndex = i;
			}
		}
	}

	const elevInfo =
		gpxElevationPoints !== null && gpxElevationPoints.length > 0
			? computeElevationRemaining(gpxElevationPoints, fromIndex, direction, rulerRange, enhancedTrailPoints)
			: null;

	const etaToEndSeconds = computeEta(distanceInfo.toTrailEnd, walkingPaceKmh);
	const etaToSectionSeconds =
		distanceInfo.toSectionEnd !== null ? computeEta(distanceInfo.toSectionEnd, walkingPaceKmh) : null;

	return (
		<div
			className="z-controls absolute top-2 right-14 flex min-w-[10rem] flex-col gap-0.5 rounded-lg bg-white/90 px-3 py-2 text-xs font-medium text-gray-800 shadow dark:bg-gray-800/90 dark:text-gray-100"
			role="status"
		>
			<div className="flex justify-between gap-4">
				<span className="text-gray-500 dark:text-gray-400">{t('traveled')}</span>
				<span>{formatDistance(distanceInfo.traveled, units, distancePrecision, true)}</span>
			</div>
			<div className="flex justify-between gap-4">
				<span className="text-gray-500 dark:text-gray-400">{t('toTrailEnd')}</span>
				<span>{formatDistance(distanceInfo.toTrailEnd, units, distancePrecision, true)}</span>
			</div>
			{distanceInfo.toSectionEnd !== null && (
				<div className="flex justify-between gap-4">
					<span className="text-gray-500 dark:text-gray-400">{t('toSectionEnd')}</span>
					<span>{formatDistance(distanceInfo.toSectionEnd, units, distancePrecision, true)}</span>
				</div>
			)}
			{elevInfo !== null && (
				<div className="mt-1 border-t border-gray-200 pt-1 dark:border-gray-700">
					<div className="flex justify-between gap-4">
						<span className="text-gray-500 dark:text-gray-400">
							<span aria-hidden="true">↑ </span>
							{t('elevGain')}
						</span>
						<span>{formatElevation(elevInfo.gainM, units)}</span>
					</div>
					<div className="flex justify-between gap-4">
						<span className="text-gray-500 dark:text-gray-400">
							<span aria-hidden="true">↓ </span>
							{t('elevLoss')}
						</span>
						<span>{formatElevation(elevInfo.lossM, units)}</span>
					</div>
					{elevInfo.sectionGainM !== null && (
						<div className="flex justify-between gap-4">
							<span className="text-gray-500 dark:text-gray-400">
								<span aria-hidden="true">↑ </span>
								{t('elevGainSection')}
							</span>
							<span>{formatElevation(elevInfo.sectionGainM, units)}</span>
						</div>
					)}
					{elevInfo.sectionLossM !== null && (
						<div className="flex justify-between gap-4">
							<span className="text-gray-500 dark:text-gray-400">
								<span aria-hidden="true">↓ </span>
								{t('elevLossSection')}
							</span>
							<span>{formatElevation(elevInfo.sectionLossM, units)}</span>
						</div>
					)}
				</div>
			)}
			<div className="mt-1 border-t border-gray-200 pt-1 dark:border-gray-700">
				<div className="flex justify-between gap-4">
					<span className="text-gray-500 dark:text-gray-400">{t('etaToEnd')}</span>
					<span aria-label={etaAriaLabel(etaToEndSeconds)}>{formatEta(etaToEndSeconds)}</span>
				</div>
				{etaToSectionSeconds !== null && (
					<div className="flex justify-between gap-4">
						<span className="text-gray-500 dark:text-gray-400">{t('etaToSection')}</span>
						<span aria-label={etaAriaLabel(etaToSectionSeconds)}>{formatEta(etaToSectionSeconds)}</span>
					</div>
				)}
			</div>
		</div>
	);
}
