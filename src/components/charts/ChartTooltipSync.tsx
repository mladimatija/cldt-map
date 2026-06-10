'use client';

/**
 * Custom Recharts tooltip that syncs the chart hover to the map trail
 * highlight (debounced both ways) and feeds the plot-scale calibration used
 * by the drag-to-ruler hit testing. Extracted from ElevationChart.
 */
import React, { useEffect, useRef } from 'react';
import { formatDistance, formatElevation } from '@/lib/utils';
import { type UnitSystem } from '@/lib/store';
import { type ElevationPoint } from './elevation-chart-shared';

export function ChartTooltipSync(props: {
	highlightTrailPosition: ((pos: { distance: number; elevation: number }) => void) | undefined;
	clearTrailHighlight: (() => void) | undefined;
	units: UnitSystem;
	distancePrecision: number;
	distanceLabel: string;
	elevationLabel: string;
	elevationUnitASL: string;
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
		active,
		payload,
		coordinate,
		isPinned,
		onScaleCalibration,
	} = props;
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
	return (
		<div className="map-tooltip !max-w-none !min-w-0">
			<p>
				<span className="font-medium">{distanceLabel}:</span> {formatDistance(point.distance, units, distancePrecision)}
			</p>
			<p>
				<span className="font-medium">{elevationLabel}:</span> {formatElevation(point.elevation, units)}{' '}
				{elevationUnitASL}
			</p>
		</div>
	);
}
