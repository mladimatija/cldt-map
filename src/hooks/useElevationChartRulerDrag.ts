'use client';

/**
 * Drag-to-ruler interaction for the elevation chart, extracted from
 * ElevationChart.
 *
 * Owns the SVG plot-scale calibration (mapping clientX to trail km), the
 * mousedown-drag-mouseup gesture state, and the resulting actions: a drag
 * sets the ruler range (and broadcasts RULER_SET_FROM_CHART_EVENT so the map
 * ruler syncs), a click pins the point and highlights it on the trail.
 */
import { useCallback, useRef, useState, type RefObject } from 'react';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { RULER_SET_FROM_CHART_EVENT } from '@/lib/ruler-from-chart';
import { type ElevationPoint, type PinnedPoint } from '@/components/charts/elevation-chart-shared';

export interface UseElevationChartRulerDragArgs {
	chartAreaRef: RefObject<HTMLDivElement | null>;
	chartData: ElevationPoint[];
	/** Called when a plain click (not a drag) pins a chart point. */
	onPin: (point: PinnedPoint) => void;
}

export interface UseElevationChartRulerDragResult {
	/** Preview range while dragging on chart (km); drives the ReferenceArea. */
	dragPreviewRange: { startKm: number; endKm: number } | null;
	/** Feed from the Recharts tooltip coordinate to calibrate clientX -> km mapping. */
	handleScaleCalibration: (coordX: number, distanceKm: number) => void;
	/** Attach to the chart container's onMouseDownCapture. */
	handleChartMouseDownCapture: (e: React.MouseEvent<HTMLDivElement>) => void;
	/** Defensive reset used when the ruler selection is cleared from the UI. */
	clearDragPreview: () => void;
}

export function useElevationChartRulerDrag({
	chartAreaRef,
	chartData,
	onPin,
}: UseElevationChartRulerDragArgs): UseElevationChartRulerDragResult {
	const [dragPreviewRange, setDragPreviewRange] = useState<{ startKm: number; endKm: number } | null>(null);
	/** Plot area in SVG pixels: used to map click X to distance. Updated from tooltip coordinate when hovering. */
	const plotScaleRef = useRef<{ plotLeft: number; plotWidth: number } | null>(null);
	const dragStartKmRef = useRef<number>(0);
	const dragEndKmRef = useRef<number>(0);
	const dragStartPointRef = useRef<{ distanceM: number; elevation: number; closest: ElevationPoint } | null>(null);
	/** True if the user moved the mouse during this gesture (so treat as drag, not click). */
	const didDragRef = useRef<boolean>(false);

	const rulerRange = useMapStore((state: MapStoreState) => state.rulerRange);
	const setRulerRange = useMapStore((state: MapStoreState) => state.setRulerRange);
	const isRulerEnabled = useMapStore((state: MapStoreState) => state.isRulerEnabled);
	const setRulerEnabled = useMapStore((state: MapStoreState) => state.setRulerEnabled);
	const highlightTrailPosition = useStore((state: StoreState) => state.highlightTrailPosition);

	const handleScaleCalibration = useCallback(
		(coordX: number, distanceKm: number) => {
			if (!chartAreaRef.current || !chartData.length) return;
			const svg = chartAreaRef.current.querySelector('svg');
			if (!svg) return;
			const svgRect = svg.getBoundingClientRect();
			const minDist = chartData[0].distance;
			const maxDist = chartData[chartData.length - 1].distance;
			const range = maxDist - minDist;
			if (range <= 0) return;
			const plotWidth = svgRect.width * 0.85;
			const plotLeft = coordX - (plotWidth * (distanceKm - minDist)) / range;
			plotScaleRef.current = { plotLeft, plotWidth };
		},
		[chartAreaRef, chartData],
	);

	const getDistanceKmFromClientX = useCallback(
		(clientX: number): number | null => {
			if (!chartAreaRef.current || !chartData.length) return null;
			const svg = chartAreaRef.current.querySelector('svg');
			if (!svg) return null;
			const svgRect = svg.getBoundingClientRect();
			const minDist = chartData[0].distance;
			const maxDist = chartData[chartData.length - 1].distance;
			const range = maxDist - minDist;
			if (range <= 0) return null;
			const clickX = clientX - svgRect.left;
			const scale = plotScaleRef.current;
			let plotLeft: number;
			let plotWidth: number;
			if (scale) {
				plotLeft = scale.plotLeft;
				plotWidth = scale.plotWidth;
			} else {
				plotLeft = svgRect.width * 0.1;
				plotWidth = svgRect.width * 0.85;
			}
			const relativeX = (clickX - plotLeft) / plotWidth;
			return minDist + Math.max(0, Math.min(1, relativeX)) * range;
		},
		[chartAreaRef, chartData],
	);

	const handleChartMouseDownCapture = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			e.preventDefault();
			e.stopPropagation();
			const distanceKm = getDistanceKmFromClientX(e.clientX);
			if (distanceKm === null || !chartData.length) return;

			if (isRulerEnabled && rulerRange) {
				const startKm = Math.min(rulerRange.distanceFromStartA, rulerRange.distanceFromStartB) / 1000;
				const endKm = Math.max(rulerRange.distanceFromStartA, rulerRange.distanceFromStartB) / 1000;
				if (distanceKm < startKm || distanceKm > endKm) {
					setRulerEnabled(false);
					return;
				}
			}

			let closest = chartData[0];
			let minDiff = Math.abs(chartData[0].distance - distanceKm);
			for (let i = 1; i < chartData.length; i++) {
				const diff = Math.abs(chartData[i].distance - distanceKm);
				if (diff < minDiff) {
					minDiff = diff;
					closest = chartData[i];
				}
			}
			const distanceM = closest.distance * 1000;
			dragStartKmRef.current = distanceKm;
			dragEndKmRef.current = distanceKm;
			dragStartPointRef.current = { distanceM, elevation: closest.elevation, closest };
			didDragRef.current = false;

			const onMouseMove = (moveEvent: MouseEvent): void => {
				const endKm = getDistanceKmFromClientX(moveEvent.clientX);
				if (endKm === null) return;
				didDragRef.current = true;
				dragEndKmRef.current = endKm;
				const start = dragStartKmRef.current;
				setDragPreviewRange({ startKm: Math.min(start, endKm), endKm: Math.max(start, endKm) });
			};
			const onMouseUp = (): void => {
				window.removeEventListener('mousemove', onMouseMove);
				window.removeEventListener('mouseup', onMouseUp);
				const startKm = dragStartKmRef.current;
				const endKm = dragEndKmRef.current;
				setDragPreviewRange(null);
				const dragSpanKm = Math.abs(endKm - startKm);
				const minDragKm = 0.05;
				const treatAsDrag = didDragRef.current || dragSpanKm >= minDragKm;
				if (treatAsDrag) {
					const startM = Math.round(startKm * 1000);
					const endM = Math.round(endKm * 1000);
					const distanceFromStartA = Math.min(startM, endM);
					const distanceFromStartB = Math.max(startM, endM);
					setRulerRange({ distanceFromStartA, distanceFromStartB });
					window.dispatchEvent(
						new CustomEvent(RULER_SET_FROM_CHART_EVENT, {
							detail: { distanceFromStartA, distanceFromStartB },
						}),
					);
				} else {
					const point = dragStartPointRef.current;
					if (point && highlightTrailPosition) {
						onPin({ distanceM: point.distanceM, elevation: point.elevation });
						highlightTrailPosition({ distance: point.distanceM, elevation: point.elevation });
					}
				}
				dragStartPointRef.current = null;
			};
			window.addEventListener('mousemove', onMouseMove);
			window.addEventListener('mouseup', onMouseUp);
		},
		[
			chartData,
			getDistanceKmFromClientX,
			highlightTrailPosition,
			isRulerEnabled,
			onPin,
			rulerRange,
			setRulerEnabled,
			setRulerRange,
		],
	);

	const clearDragPreview = useCallback((): void => {
		setDragPreviewRange(null);
	}, []);

	return { dragPreviewRange, handleScaleCalibration, handleChartMouseDownCapture, clearDragPreview };
}
