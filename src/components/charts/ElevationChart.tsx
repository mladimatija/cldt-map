'use client';

/**
 * Elevation profile chart (distance vs. elevation). Hover syncs with the trail highlight on the map via ChartTooltipSync.
 * Uses Recharts AreaChart; data comes from store enhancedTrailPoints / gpxElevationPoints.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, JSX } from 'react';
import { useBlockMapPropagation } from '@/hooks';
import {
	AreaChart,
	Area,
	XAxis,
	YAxis,
	CartesianGrid,
	ResponsiveContainer,
	ReferenceLine,
	ReferenceArea,
	Tooltip,
} from 'recharts';
import { formatElevation, formatDistance } from '@/lib/utils';
import { useStore, useMapStore, type StoreState, type MapStoreState, type UnitSystem } from '@/lib/store';
import { MdKeyboardArrowUp, MdKeyboardArrowDown } from 'react-icons/md';
import { useTranslations } from 'next-intl';
import { RULER_SET_FROM_CHART_EVENT, type RulerSetFromChartDetail } from '@/lib/ruler-from-chart';
import { Button } from '@/components/ui/Button';

interface ElevationPoint {
	distance: number;
	elevation: number;
	lat?: number;
	lng?: number;
}

interface ElevationChartProps {
	className?: string;
}

/** Custom Tooltip that syncs the chart hover to map highlight. */
function ChartTooltipSync(props: {
	highlightTrailPosition: ((pos: { distance: number; elevation: number }) => void) | undefined;
	clearTrailHighlight: (() => void) | undefined;
	units: UnitSystem;
	distancePrecision: number;
	distanceLabel: string;
	elevationLabel: string;
	active?: boolean;
	payload?: ReadonlyArray<{ payload: ElevationPoint }>;
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
		if (active && payload?.[0]) {
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

	if (!active || !payload?.[0]) {
		return null;
	}
	const point = payload[0].payload;
	return (
		<div className="map-tooltip !max-w-none !min-w-0">
			<p>
				<span className="font-medium">{distanceLabel}:</span> {formatDistance(point.distance, units, distancePrecision)}
			</p>
			<p>
				<span className="font-medium">{elevationLabel}:</span> {formatElevation(point.elevation, units)}
			</p>
		</div>
	);
}

type PinnedPoint = { distanceM: number; elevation: number };

export default function ElevationChart({ className = '' }: ElevationChartProps): JSX.Element | null {
	const t = useTranslations('elevationChart');
	const tCommon = useTranslations('common');
	const [chartData, setChartData] = useState<ElevationPoint[]>([]);
	const [userProgress, setUserProgress] = useState<number | null>(null);
	const [isExpanded, setIsExpanded] = useState<boolean>(false);
	const [pinnedPoint, setPinnedPoint] = useState<PinnedPoint | null>(null);
	/** Preview range while dragging on chart (km); triggers ReferenceArea. */
	const [dragPreviewRange, setDragPreviewRange] = useState<{ startKm: number; endKm: number } | null>(null);
	const chartAreaRef = useRef<HTMLDivElement | null>(null);
	/** Plot area in SVG pixels: used to map click X to distance. Updated from tooltip coordinate when hovering. */
	const plotScaleRef = useRef<{ plotLeft: number; plotWidth: number } | null>(null);
	const dragStartKmRef = useRef<number>(0);
	const dragEndKmRef = useRef<number>(0);
	const dragStartPointRef = useRef<{ distanceM: number; elevation: number; closest: ElevationPoint } | null>(null);
	/** True if the user moved the mouse during this gesture (so treat as drag, not click). */
	const didDragRef = useRef<boolean>(false);

	const units = useMapStore((state: MapStoreState) => state.units);
	const direction = useMapStore((state: MapStoreState) => state.direction);
	const distancePrecision = useMapStore((state: MapStoreState) => state.distancePrecision);
	const rulerRange = useMapStore((state: MapStoreState) => state.rulerRange);
	const setRulerRange = useMapStore((state: MapStoreState) => state.setRulerRange);
	const isRulerEnabled = useMapStore((state: MapStoreState) => state.isRulerEnabled);
	const setRulerEnabled = useMapStore((state: MapStoreState) => state.setRulerEnabled);
	const closestPoint = useStore((state: StoreState) => state.closestPoint);
	const enhancedTrailPoints = useStore((state: StoreState) => state.enhancedTrailPoints);
	const highlightedTrailPoint = useStore((state: StoreState) => state.highlightedTrailPoint);
	const highlightTrailPosition = useStore((state: StoreState) => state.highlightTrailPosition);
	const clearTrailHighlight = useStore((state: StoreState) => state.clearTrailHighlight);
	const trailMetadata = useStore((state: StoreState) => state.trailMetadata);
	const gpxLoaded = useStore((state: StoreState) => state.gpxLoaded);
	const gpxLoadFailed = useMapStore((state: MapStoreState) => state.gpxLoadFailed);
	const chartRef = useRef<HTMLDivElement>(null);
	useBlockMapPropagation(chartRef, [chartData.length]);

	// Unpin when the trail tooltip is closed (e.g., the user clicks close on the map tooltip).
	useEffect(() => {
		if (!highlightedTrailPoint) {
			queueMicrotask(() => setPinnedPoint(null));
		}
	}, [highlightedTrailPoint]);

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
		[chartData],
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
		[chartData],
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
							detail: { distanceFromStartA, distanceFromStartB } as RulerSetFromChartDetail,
						}),
					);
				} else {
					const point = dragStartPointRef.current;
					if (point && highlightTrailPosition) {
						setPinnedPoint({ distanceM: point.distanceM, elevation: point.elevation });
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
			rulerRange,
			setRulerEnabled,
			setRulerRange,
		],
	);

	const totalDistance = trailMetadata?.totalDistance || 0;
	const elevationGain = trailMetadata?.elevationGain || 0;
	const elevationLoss = trailMetadata?.elevationLoss || 0;

	useEffect(() => {
		if (!enhancedTrailPoints || enhancedTrailPoints.length === 0 || !gpxLoaded) {
			return;
		}

		const sampleSize = Math.min(enhancedTrailPoints.length, 500);
		const skipFactor = Math.max(1, Math.floor(enhancedTrailPoints.length / sampleSize));
		const elevationData: ElevationPoint[] = [];

		for (let i = 0; i < enhancedTrailPoints.length; i += skipFactor) {
			const point = enhancedTrailPoints[i];
			elevationData.push({
				distance: point.distanceFromStart / 1000,
				elevation: point.elevation,
				lat: point.lat,
				lng: point.lng,
			});
		}
		if (enhancedTrailPoints.length > 1) {
			const last = enhancedTrailPoints[enhancedTrailPoints.length - 1];
			const lastDist = last.distanceFromStart / 1000;
			const lastInData = elevationData[elevationData.length - 1]?.distance;
			const needLast =
				elevationData.length === 0 || (lastInData !== undefined && Math.abs(lastInData - lastDist) > 0.001);
			if (needLast) {
				elevationData.push({
					distance: lastDist,
					elevation: last.elevation,
					lat: last.lat,
					lng: last.lng,
				});
			}
		}

		queueMicrotask(() => setChartData(elevationData));
	}, [enhancedTrailPoints, gpxLoaded, direction]);

	useEffect(() => {
		let cancelled = false;
		if (closestPoint) {
			queueMicrotask(() => {
				if (!cancelled) {
					setUserProgress(closestPoint.distanceFromStart / 1000);
				}
			});
		} else {
			queueMicrotask(() => {
				if (!cancelled) {
					setUserProgress(null);
				}
			});
		}
		return () => {
			cancelled = true;
		};
	}, [closestPoint]);

	const highlightedPoint = useMemo((): ElevationPoint | null => {
		if (!highlightedTrailPoint || chartData.length === 0) {
			return null;
		}
		const distanceInKm = highlightedTrailPoint.distanceFromStart / 1000;
		let closest = chartData[0];
		let minDiff = Math.abs(chartData[0].distance - distanceInKm);
		for (let i = 1; i < chartData.length; i++) {
			const diff = Math.abs(chartData[i].distance - distanceInKm);
			if (diff < minDiff) {
				minDiff = diff;
				closest = chartData[i];
			}
		}
		return closest;
	}, [highlightedTrailPoint, chartData]);

	const rulerHighlightRange = useMemo((): { startKm: number; endKm: number } | null => {
		if (dragPreviewRange) return dragPreviewRange;
		if (rulerRange)
			return {
				startKm: rulerRange.distanceFromStartA / 1000,
				endKm: rulerRange.distanceFromStartB / 1000,
			};
		return null;
	}, [dragPreviewRange, rulerRange]);

	const toggleExpanded = (): void => {
		setIsExpanded(!isExpanded);
	};

	if (chartData.length === 0) {
		const emptyMessage = gpxLoadFailed ? tCommon('failedToLoadTrail') : gpxLoaded ? t('noData') : t('loading');
		return (
			<div className={`rounded bg-white p-4 shadow ${className}`} ref={chartRef}>
				<h2 className="text-cldt-blue-contrast mb-0 text-lg font-semibold">{emptyMessage}</h2>
			</div>
		);
	}

	const highestPoint = Math.max(...chartData.map((p) => p.elevation));
	const lowestPoint = Math.min(...chartData.map((p) => p.elevation));
	const yDomainPadding = (highestPoint - lowestPoint) * 0.1;
	const yDomain: [number, number] = [Math.max(0, lowestPoint - yDomainPadding), highestPoint + yDomainPadding];
	const directionText = direction === 'SOBO' ? t('directionNorthSouth') : t('directionSouthNorth');

	const stopMapInteraction = (e: React.PointerEvent): void => {
		e.stopPropagation();
	};
	const stopMapInteractionTouch = (e: React.TouchEvent): void => {
		e.preventDefault();
		e.stopPropagation();
	};

	const clearPinnedSelection = (): void => {
		setPinnedPoint(null);
		clearTrailHighlight?.(true);
	};

	const clearRulerSelection = (): void => {
		setDragPreviewRange(null);
		setRulerRange(null);
		setRulerEnabled(false);
	};

	return (
		<div
			className={`rounded bg-white p-4 shadow outline-none focus:outline-none focus-visible:outline-none dark:border dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)] [&_*]:ring-0 [&_*]:outline-none [&_*]:focus:ring-0 [&_*]:focus:outline-none [&_*]:focus-visible:outline-none ${className} transition-[height] duration-300 ease-in-out ${isExpanded ? 'h-[400px]' : 'h-[120px] min-h-[120px] sm:h-[100px] sm:min-h-[100px]'}`}
			key={`elevation-chart-${units}-${direction}`}
			ref={chartRef}
			onPointerCancel={stopMapInteraction}
			onPointerDown={stopMapInteraction}
			onPointerMove={stopMapInteraction}
			onPointerUp={stopMapInteraction}
		>
			<div
				className="flex cursor-pointer items-center justify-between outline-none focus:outline-none"
				onClick={toggleExpanded}
			>
				<h2 className="text-cldt-blue-contrast text-base font-semibold sm:text-lg">{t('title')}</h2>
				<div className="flex items-center gap-2">
					{pinnedPoint !== null && (
						<Button
							size="sm"
							variant="base"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								clearPinnedSelection();
							}}
							onMouseDown={(e) => e.stopPropagation()}
						>
							{t('clearPin')}
						</Button>
					)}
					{isRulerEnabled && (
						<Button
							size="sm"
							variant="base"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								clearRulerSelection();
							}}
							onMouseDown={(e) => e.stopPropagation()}
						>
							{t('clearRuler')}
						</Button>
					)}
					<div aria-hidden className="text-cldt-blue-contrast shrink-0 text-xl">
						{isExpanded ? <MdKeyboardArrowUp /> : <MdKeyboardArrowDown />}
					</div>
				</div>
			</div>

			<div
				className="my-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-700 sm:flex sm:flex-wrap sm:gap-x-4 sm:text-sm dark:text-[var(--text-secondary)]"
				onClick={toggleExpanded}
			>
				<span className="truncate" title={formatDistance(totalDistance, units, distancePrecision)}>
					{t('distance')}: {formatDistance(totalDistance, units, distancePrecision)}
				</span>
				<span className="truncate" title={directionText}>
					{t('direction')}: {directionText}
				</span>
				<span className="truncate" title={formatElevation(elevationGain, units)}>
					{t('gain')}: {formatElevation(elevationGain, units)}
				</span>
				<span className="truncate" title={formatElevation(elevationLoss, units)}>
					{t('loss')}: {formatElevation(elevationLoss, units)}
				</span>
			</div>
			{isExpanded && (
				<div
					className="h-[calc(100%-3.5rem)] min-h-[200px]"
					ref={chartAreaRef}
					role="presentation"
					onMouseDownCapture={handleChartMouseDownCapture}
					onTouchStartCapture={stopMapInteractionTouch}
				>
					<ResponsiveContainer height="100%" minHeight={200} width="100%">
						<AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
							<Tooltip
								content={(props) => (
									<ChartTooltipSync
										active={props.active}
										clearTrailHighlight={clearTrailHighlight}
										coordinate={props.coordinate}
										distanceLabel={t('distanceLabel')}
										distancePrecision={distancePrecision}
										elevationLabel={t('elevationLabel')}
										highlightTrailPosition={highlightTrailPosition}
										isPinned={pinnedPoint !== null}
										payload={props.payload}
										units={units}
										onScaleCalibration={handleScaleCalibration}
									/>
								)}
								cursor={{ stroke: 'var(--cldt-green)', strokeWidth: 2 }}
							/>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis
								dataKey="distance"
								label={{
									value: units === 'metric' ? t('distanceKm') : t('distanceMi'),
									position: 'insideBottomRight',
									offset: -5,
								}}
								tickFormatter={(value) => formatDistance(value, units, distancePrecision)}
								type="number"
							/>
							<YAxis
								domain={yDomain}
								label={{
									value: units === 'metric' ? t('elevationM') : t('elevationFt'),
									angle: -90,
									position: 'insideLeft',
								}}
								tickFormatter={(value) => formatElevation(value, units)}
							/>
							<Area
								activeDot={{ r: 6, fill: 'var(--cldt-green)' }}
								dataKey="elevation"
								dot={false}
								fill="var(--cldt-light-blue)"
								stroke="var(--cldt-blue)"
								type="monotone"
							/>
							{highlightedPoint && (
								<ReferenceLine
									stroke="var(--cldt-green)"
									strokeDasharray="3 3"
									strokeWidth={2}
									x={highlightedPoint.distance}
								/>
							)}
							{userProgress !== null && <ReferenceLine stroke="var(--cldt-green)" strokeWidth={2} x={userProgress} />}
							{rulerHighlightRange && (
								<ReferenceArea
									fill="var(--cldt-green)"
									fillOpacity={0.35}
									ifOverflow="visible"
									stroke="var(--cldt-green)"
									strokeOpacity={0.9}
									strokeWidth={2}
									x1={rulerHighlightRange.startKm}
									x2={rulerHighlightRange.endKm}
									y1={yDomain[0]}
									y2={yDomain[1]}
									zIndex={1}
								/>
							)}
						</AreaChart>
					</ResponsiveContainer>
				</div>
			)}
		</div>
	);
}
