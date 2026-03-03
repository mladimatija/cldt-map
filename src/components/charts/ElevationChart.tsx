'use client';

/**
 * Elevation profile chart (distance vs. elevation). Hover syncs with the trail highlight on the map via ChartTooltipSync.
 * Uses Recharts AreaChart; data comes from store enhancedTrailPoints / gpxElevationPoints.
 */
import React, { useEffect, useMemo, useRef, useState, JSX } from 'react';
import { useBlockMapPropagation } from '@/hooks';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine, Tooltip } from 'recharts';
import { formatElevation, formatDistance } from '@/lib/utils';
import { useStore, useMapStore, type StoreState, type MapStoreState, type UnitSystem } from '@/lib/store';
import { MdKeyboardArrowUp, MdKeyboardArrowDown } from 'react-icons/md';
import { useTranslations } from 'next-intl';

interface ElevationPoint {
	distance: number;
	elevation: number;
	lat?: number;
	lng?: number;
}

interface ElevationChartProps {
	className?: string;
}

/** Custom Tooltip that syncs chart hover to map highlight */
function ChartTooltipSync(props: {
	highlightTrailPosition: ((pos: { distance: number; elevation: number }) => void) | undefined;
	clearTrailHighlight: (() => void) | undefined;
	units: UnitSystem;
	distancePrecision: number;
	distanceLabel: string;
	elevationLabel: string;
	active?: boolean;
	payload?: Array<{ payload: ElevationPoint }>;
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
	} = props;
	const prevDistanceRef = useRef<number | null>(null);
	const wasActiveRef = useRef(false);

	useEffect(() => {
		if (active && payload?.[0]) {
			wasActiveRef.current = true;
			const point = payload[0].payload;
			const distance = point.distance * 1000;
			if (prevDistanceRef.current !== distance) {
				prevDistanceRef.current = distance;
				highlightTrailPosition?.({
					distance,
					elevation: point.elevation,
				});
			}
		} else {
			if (wasActiveRef.current) {
				wasActiveRef.current = false;
				prevDistanceRef.current = null;
				clearTrailHighlight?.();
			}
		}
	}, [active, payload, highlightTrailPosition, clearTrailHighlight]);

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

export default function ElevationChart({ className = '' }: ElevationChartProps): JSX.Element | null {
	const t = useTranslations('elevationChart');
	const tCommon = useTranslations('common');
	const [chartData, setChartData] = useState<ElevationPoint[]>([]);
	const [userProgress, setUserProgress] = useState<number | null>(null);
	const [isExpanded, setIsExpanded] = useState<boolean>(false);

	const units = useMapStore((state: MapStoreState) => state.units);
	const direction = useMapStore((state: MapStoreState) => state.direction);
	const distancePrecision = useMapStore((state: MapStoreState) => state.distancePrecision);
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

	return (
		<div
			className={`rounded bg-white p-4 shadow outline-none focus:outline-none focus-visible:outline-none [&_*]:ring-0 [&_*]:outline-none [&_*]:focus:ring-0 [&_*]:focus:outline-none [&_*]:focus-visible:outline-none ${className} transition-[height] duration-300 ease-in-out ${isExpanded ? 'h-[400px]' : 'h-[120px] min-h-[120px] sm:h-[100px] sm:min-h-[100px]'}`}
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
				<div aria-hidden className="text-cldt-blue-contrast shrink-0 text-xl">
					{isExpanded ? <MdKeyboardArrowUp /> : <MdKeyboardArrowDown />}
				</div>
			</div>

			<div
				className="my-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-700 sm:flex sm:flex-wrap sm:gap-x-4 sm:text-sm"
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
				<div className="h-[calc(100%-3.5rem)] min-h-[200px]">
					<ResponsiveContainer height="100%" minHeight={200} width="100%">
						<AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
							<Tooltip
								content={
									<ChartTooltipSync
										clearTrailHighlight={clearTrailHighlight}
										distanceLabel={t('distanceLabel')}
										distancePrecision={distancePrecision}
										elevationLabel={t('elevationLabel')}
										highlightTrailPosition={highlightTrailPosition}
										units={units}
									/>
								}
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
						</AreaChart>
					</ResponsiveContainer>
				</div>
			)}
		</div>
	);
}
