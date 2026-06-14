'use client';

/**
 * Custom Recharts tooltip that syncs the chart hover to the map trail
 * highlight (debounced both ways) and feeds the plot-scale calibration used
 * by the drag-to-ruler hit testing. Extracted from ElevationChart.
 */
import React, { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { formatDistance, formatElevation } from '@/lib/utils';
import { type UnitSystem } from '@/lib/store';
import { type TrailDirection } from '@/lib/types';
import { type TrailOsmTagRun } from '@/lib/trail-osm-tags';
import { SAC_BUCKET_SHORT_LABELS, SAC_COLORS, SURFACE_COLORS } from '@/components/map/trail-route-constants';
import { resolveOsmAtTrailKm, type ElevationChartFillMode, type ElevationPoint } from './elevation-chart-shared';

export function ChartTooltipSync(props: {
	highlightTrailPosition: ((pos: { distance: number; elevation: number }) => void) | undefined;
	clearTrailHighlight: (() => void) | undefined;
	units: UnitSystem;
	distancePrecision: number;
	distanceLabel: string;
	elevationLabel: string;
	elevationUnitASL: string;
	fillMode: ElevationChartFillMode;
	trailOsmRuns: TrailOsmTagRun[] | null | undefined;
	direction: TrailDirection;
	totalKm: number;
	active?: boolean;
	payload?: ReadonlyArray<{ payload?: ElevationPoint }>;
	coordinate?: { x: number; y: number };
	isPinned: boolean;
	onScaleCalibration?: (coordX: number, distanceKm: number) => void;
}): React.ReactElement | null {
	const {
		highlightTrailPosition,
		clearTrailHighlight,
		units,
		distancePrecision,
		distanceLabel,
		elevationLabel,
		elevationUnitASL,
		fillMode,
		trailOsmRuns,
		direction,
		totalKm,
		active,
		payload,
		coordinate,
		isPinned,
		onScaleCalibration,
	} = props;
	const t = useTranslations('elevationChart');
	const tTrailStyle = useTranslations('mapControls.layers.trailStyle');
	const prevDistanceRef = useRef<number | null>(null);
	const wasActiveRef = useRef(false);
	const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const clearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const HIGHLIGHT_DEBOUNCE_MS = 80;
	const CLEAR_DEBOUNCE_MS = 120;

	useEffect(() => {
		if (active && payload?.[0]?.payload) {
			const point = payload[0].payload;
			if (coordinate !== undefined && coordinate !== null && typeof onScaleCalibration === 'function') {
				onScaleCalibration(coordinate.x, point.distance);
			}
			wasActiveRef.current = true;
			if (clearTimeoutRef.current) {
				clearTimeout(clearTimeoutRef.current);
				clearTimeoutRef.current = null;
			}
			if (!isPinned) {
				const distance = point.distance * 1000;
				if (prevDistanceRef.current !== distance) {
					if (highlightTimeoutRef.current) {
						clearTimeout(highlightTimeoutRef.current);
						highlightTimeoutRef.current = null;
					}
					highlightTimeoutRef.current = setTimeout(() => {
						prevDistanceRef.current = distance;
						highlightTrailPosition?.({
							distance,
							elevation: point.elevation,
						});
						highlightTimeoutRef.current = null;
					}, HIGHLIGHT_DEBOUNCE_MS);
				}
			}
		} else {
			if (!isPinned && wasActiveRef.current) {
				if (highlightTimeoutRef.current) {
					clearTimeout(highlightTimeoutRef.current);
					highlightTimeoutRef.current = null;
				}
				if (clearTimeoutRef.current) {
					clearTimeout(clearTimeoutRef.current);
				}
				clearTimeoutRef.current = setTimeout(() => {
					wasActiveRef.current = false;
					prevDistanceRef.current = null;
					clearTrailHighlight?.();
					clearTimeoutRef.current = null;
				}, CLEAR_DEBOUNCE_MS);
			}
		}
		return () => {
			if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
			if (clearTimeoutRef.current) clearTimeout(clearTimeoutRef.current);
		};
	}, [active, payload, coordinate, highlightTrailPosition, clearTrailHighlight, isPinned, onScaleCalibration]);

	if (!active || !payload?.[0]?.payload) {
		return null;
	}
	const point = payload[0].payload;
	const osm =
		fillMode === 'surface' || fillMode === 'sac'
			? resolveOsmAtTrailKm(point.distance, direction, totalKm, trailOsmRuns)
			: null;

	return (
		<div className="map-tooltip !max-w-none !min-w-0">
			<p>
				<span className="font-medium">{distanceLabel}:</span> {formatDistance(point.distance, units, distancePrecision)}
			</p>
			<p>
				<span className="font-medium">{elevationLabel}:</span> {formatElevation(point.elevation, units)}{' '}
				{elevationUnitASL}
			</p>
			{fillMode === 'surface' && osm && (
				<>
					<p className="flex items-center gap-2">
						<span className="font-medium">{t('osmSurfaceLabel')}:</span>
						<span className="inline-flex items-center gap-1.5">
							<span
								aria-hidden="true"
								className="inline-block h-2 w-4 shrink-0 rounded-sm"
								style={{ backgroundColor: SURFACE_COLORS[osm.surfaceBucket] }}
							/>
							{tTrailStyle(`surfaceBuckets.${osm.surfaceBucket}`)}
						</span>
					</p>
					{(osm.run?.surface || osm.run?.highway) && (
						<p className="text-xs opacity-75">
							{osm.run.surface ? (
								<span>
									surface={osm.run.surface}
									{osm.run.highway ? ' · ' : ''}
								</span>
							) : null}
							{osm.run?.highway ? (
								<span>
									{t('osmHighwayLabel')}={osm.run.highway}
								</span>
							) : null}
						</p>
					)}
				</>
			)}
			{fillMode === 'sac' && osm && (
				<>
					<p className="flex items-center gap-2">
						<span className="font-medium">{t('osmSacLabel')}:</span>
						<span className="inline-flex items-center gap-1.5">
							<span
								aria-hidden="true"
								className="inline-block h-2 w-4 shrink-0 rounded-sm"
								style={{ backgroundColor: SAC_COLORS[osm.sacBucket] }}
							/>
							<span className="font-mono">{SAC_BUCKET_SHORT_LABELS[osm.sacBucket]}</span>
							{tTrailStyle(`sacBuckets.${osm.sacBucket}`)}
						</span>
					</p>
					{osm.run?.sac_scale ? (
						<p className="text-xs opacity-75">sac_scale={osm.run.sac_scale}</p>
					) : (
						<p className="text-xs opacity-75">{t('osmTagUntagged')}</p>
					)}
				</>
			)}
		</div>
	);
}
