'use client';

/**
 * Elevation profile chart (distance vs. elevation). Hover syncs with the trail highlight on the map via ChartTooltipSync.
 * Uses Recharts AreaChart; data comes from store enhancedTrailPoints / gpxElevationPoints.
 */
import React, { useEffect, useMemo, useRef, useState, JSX } from 'react';
import { useBlockMapPropagation, usePackAdjustedPaceKmh } from '@/hooks';
import {
	AreaChart,
	Area,
	XAxis,
	YAxis,
	CartesianGrid,
	ResponsiveContainer,
	ReferenceLine,
	ReferenceDot,
	ReferenceArea,
	Tooltip as RechartsTooltip,
} from 'recharts';
import { formatElevation, formatDistance } from '@/lib/utils';
import { computeEta, findNearestPointIndex } from '@/lib/distance-utils';
import { useStore, useMapStore, type StoreState, type MapStoreState } from '@/lib/store';
import { bucketSac, bucketSurface, findRunAtKm } from '@/lib/trail-osm-tags';
import { SAC_COLORS, SURFACE_COLORS } from '@/components/map/trail-route-constants';
import { TRAIL_SECTIONS } from '@/lib/trail-sections';
import {
	GRADE_BUCKETS,
	SAC_BUCKETS,
	SECTION_BUCKETS,
	SECTION_COLOR_BY_KEY,
	SURFACE_BUCKETS,
	formatHikingTime,
	gradeColorForKey,
	type ElevationPoint,
	type PinnedPoint,
} from './elevation-chart-shared';
import { ChartTooltipSync } from './ChartTooltipSync';
import { useElevationChartRulerDrag } from '@/hooks/useElevationChartRulerDrag';
import { MdKeyboardArrowUp, MdKeyboardArrowDown } from 'react-icons/md';
import { IoDownloadOutline, IoHelpCircleOutline } from 'react-icons/io5';
import { useTranslations } from 'next-intl';
import { Tooltip } from '@/components/ui/Tooltip';
import { Button } from '@/components/ui/Button';
import { GpxDownloadModal } from '@/components/map/GpxDownloadModal';
import { buildGpxXml, downloadGpxFile, extractGpxSegment, shareGpxFile } from '@/lib/gpx-export';

export { SAC_BUCKETS, SURFACE_BUCKETS } from './elevation-chart-shared';

interface ElevationChartProps {
	className?: string;
}

export default function ElevationChart({ className = '' }: ElevationChartProps): JSX.Element | null {
	const t = useTranslations('elevationChart');
	const tCommon = useTranslations('common');
	const tControls = useTranslations('mapControls');
	const tTrail = useTranslations('trailRoute');
	const tGpx = useTranslations('gpxDownload');
	const [chartData, setChartData] = useState<ElevationPoint[]>([]);
	const [userProgress, setUserProgress] = useState<number | null>(null);
	const [isExpanded, setIsExpanded] = useState<boolean>(false);
	const [pinnedPoint, setPinnedPoint] = useState<PinnedPoint | null>(null);
	const [gpxModalOpen, setGpxModalOpen] = useState(false);
	const [gpxModalMode, setGpxModalMode] = useState<'full' | 'segment'>('full');
	const chartAreaRef = useRef<HTMLDivElement | null>(null);

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
	const rawGpxData = useMapStore((state: MapStoreState) => state.rawGpxData);
	const walkingPaceKmh = usePackAdjustedPaceKmh();
	const gradeAdjustedEta = useMapStore((state: MapStoreState) => state.gradeAdjustedEta);
	const darkMode = useMapStore((state: MapStoreState) => state.darkMode);
	const surfaceColoured = useMapStore((state: MapStoreState) => state.surfaceColoured);
	const sacColoured = useMapStore((state: MapStoreState) => state.sacColoured);
	const showSections = useMapStore((state: MapStoreState) => state.showSections);
	const gradeTintedTrail = useMapStore((state: MapStoreState) => state.gradeTintedTrail);
	const trailOsmTagsFile = useMapStore((state: MapStoreState) => state.trailOsmTagsFile);
	const axisTextColor = darkMode ? 'var(--text-primary)' : undefined;
	const chartRef = useRef<HTMLDivElement>(null);
	useBlockMapPropagation(chartRef, [chartData.length]);

	// Unpin when the trail tooltip is closed (e.g., the user clicks close on the map tooltip).
	useEffect(() => {
		if (!highlightedTrailPoint) {
			queueMicrotask(() => setPinnedPoint(null));
		}
	}, [highlightedTrailPoint]);

	// Drag-to-ruler gesture handling (plot calibration, drag preview, click-to-pin).
	const { dragPreviewRange, handleScaleCalibration, handleChartMouseDownCapture, clearDragPreview } =
		useElevationChartRulerDrag({
			chartAreaRef,
			chartData,
			onPin: setPinnedPoint,
		});

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

	// Segment geometry - recomputes only when the ruler range or trail data changes.
	// Does NOT depend on gradeAdjustedEta or walkingPaceKmh, so toggling the pace model
	// never re-runs the O(n) filter pass.
	const rulerSegment = useMemo(() => {
		if (!isRulerEnabled || !rulerRange || !enhancedTrailPoints?.length) return null;
		const { distanceFromStartA, distanceFromStartB } = rulerRange;
		// enhancedTrailPoints is already ordered by distanceFromStart - no sort needed.
		const segment = enhancedTrailPoints.filter(
			(p) => p.distanceFromStart >= distanceFromStartA && p.distanceFromStart <= distanceFromStartB,
		);
		if (segment.length < 2) return null;
		const distanceM = distanceFromStartB - distanceFromStartA;
		const distanceKm = distanceM / 1000;
		const gain = segment[segment.length - 1].elevationGainFromStart - segment[0].elevationGainFromStart;
		const loss = segment[segment.length - 1].elevationLossFromStart - segment[0].elevationLossFromStart;
		// Use nearest-distance lookup instead of strict equality to avoid floating-point mismatch.
		const fromIndex = findNearestPointIndex(enhancedTrailPoints, distanceFromStartA);
		const sections = [...new Set(segment.map((p) => p.sectionName).filter(Boolean))] as string[];
		return { distanceKm, distanceM, gain, loss, fromIndex, sections };
	}, [isRulerEnabled, rulerRange, enhancedTrailPoints]);

	// ETA - lightweight memo that only recomputes when pace, direction, or grade toggle changes.
	const rulerStats = useMemo(() => {
		if (!rulerSegment) return null;
		const { distanceM, distanceKm, gain, loss, fromIndex, sections } = rulerSegment;
		const etaSeconds = computeEta(distanceM, walkingPaceKmh, {
			elevationPoints: enhancedTrailPoints,
			fromIndex,
			direction,
			gradeAdjusted: gradeAdjustedEta,
		});
		const hikingTimeMin = Math.round(etaSeconds / 60);
		return { distanceKm, gain, loss, hikingTimeMin, sections };
	}, [rulerSegment, enhancedTrailPoints, walkingPaceKmh, direction, gradeAdjustedEta]);

	const toggleExpanded = (): void => {
		setIsExpanded(!isExpanded);
	};

	// Fill-by-metric for the elevation area chart. When any color-coded trail
	// style is active, the chart renders one Area per bucket, so the elevation
	// profile visually mirrors the polyline. Surface and SAC additionally
	// require the OSM tag dataset to be loaded.
	const fillMode: 'surface' | 'sac' | 'sections' | 'grade' | null = useMemo(() => {
		if (sacColoured && trailOsmTagsFile?.runs?.length) return 'sac';
		if (surfaceColoured && trailOsmTagsFile?.runs?.length) return 'surface';
		if (gradeTintedTrail && enhancedTrailPoints.length > 0) return 'grade';
		if (showSections && enhancedTrailPoints.length > 0) return 'sections';
		return null;
	}, [sacColoured, surfaceColoured, gradeTintedTrail, showSections, trailOsmTagsFile, enhancedTrailPoints]);

	const enrichedChartData = useMemo(() => {
		if (!fillMode || chartData.length === 0) return chartData;

		// Resolve the bucket key for a given chart point per the active fillMode.
		// Surface and SAC read from the SOBO-keyed OSM tag dataset; sections and grade
		// read from the direction-adjusted enhancedTrailPoints (sectionName /
		// gradeBand / gradePct are all already direction-relative there).
		const bucketKeyAt: ((p: ElevationPoint) => string) | null = ((): ((p: ElevationPoint) => string) | null => {
			if (fillMode === 'surface' || fillMode === 'sac') {
				const runs = trailOsmTagsFile?.runs;
				if (!runs?.length) return null;
				const totalKm = trailMetadata?.totalDistance ?? 0;
				return (p) => {
					const soboKm = direction === 'SOBO' ? p.distance : Math.max(0, totalKm - p.distance);
					const run = findRunAtKm(runs, soboKm);
					return fillMode === 'surface' ? bucketSurface(run?.surface ?? null) : bucketSac(run?.sac_scale ?? null);
				};
			}
			if (enhancedTrailPoints.length === 0) return null;
			return (p) => {
				const idx = findNearestPointIndex(enhancedTrailPoints, p.distance * 1000);
				const ep = enhancedTrailPoints[idx];
				if (fillMode === 'sections') {
					// In practice every enhanced trail point has a sectionName because
					// TRAIL_SECTIONS spans 0..Infinity. The fallback to the first section
					// only fires for the degenerate empty-data case and prevents an
					// `elev_undefined` dataKey from polluting the chart.
					return ep?.sectionName ?? TRAIL_SECTIONS[0].nameKey;
				}
				const band = ep?.gradeBand ?? 0;
				const sign = (ep?.gradePct ?? 0) < 0 ? 'desc' : 'asc';
				return `g${band}_${sign}`;
			};
		})();
		if (!bucketKeyAt) return chartData;

		// Bridge transitions: when the bucket changes between two consecutive chart
		// points, also set the current point's value under the previous bucket's key
		// so adjacent Areas share a vertex. Without this, Recharts's connectNulls=false
		// leaves a one-sample gap (~ 4-5 km on a 2,220 km trail downsampled to 500
		// points) wherever the bucket changes.
		const enriched = new Array<ElevationPoint>(chartData.length);
		let prevKey: string | null = null;
		for (let i = 0; i < chartData.length; i++) {
			const p = chartData[i];
			const key = bucketKeyAt(p);
			const next: ElevationPoint & Record<string, number | undefined> = {
				...p,
				[`elev_${key}`]: p.elevation,
			};
			if (prevKey !== null && prevKey !== key) {
				next[`elev_${prevKey}`] = p.elevation;
			}
			enriched[i] = next;
			prevKey = key;
		}
		return enriched;
	}, [chartData, fillMode, trailOsmTagsFile, direction, trailMetadata, enhancedTrailPoints]);

	const { highestPoint, lowestPoint } = useMemo(() => {
		let high = -Infinity;
		let low = Infinity;
		for (const p of chartData) {
			if (p.elevation > high) high = p.elevation;
			if (p.elevation < low) low = p.elevation;
		}
		return { highestPoint: high, lowestPoint: low };
	}, [chartData]);

	if (chartData.length === 0) {
		const emptyMessage = gpxLoadFailed ? tCommon('failedToLoadTrail') : gpxLoaded ? t('noData') : t('loading');
		return (
			<div className={`rounded bg-white p-4 shadow ${className}`} ref={chartRef}>
				<h2 className="text-cldt-blue-contrast mb-0 text-lg font-semibold dark:text-[var(--text-primary)]">
					{emptyMessage}
				</h2>
			</div>
		);
	}

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
		clearDragPreview();
		setRulerRange(null);
		setRulerEnabled(false);
	};

	const openGpxModal = (mode: 'full' | 'segment'): void => {
		setGpxModalMode(mode);
		setGpxModalOpen(true);
	};

	/** Builds the GPX payload for the current modal mode, or null when the
	 *  required data is not available. Shared by download and share paths. */
	const buildGpxPayload = (): { gpx: string; filename: string } | null => {
		if (gpxModalMode === 'full') {
			if (rawGpxData) {
				return { gpx: rawGpxData, filename: tGpx('filenameFullTrail') };
			}
			if (enhancedTrailPoints?.length) {
				return {
					gpx: buildGpxXml(
						enhancedTrailPoints.map((p) => ({ lat: p.lat, lng: p.lng, elevation: p.elevation })),
						'Croatian Long Distance Trail',
					),
					filename: tGpx('filenameFullTrail'),
				};
			}
			return null;
		}
		if (gpxModalMode === 'segment' && rulerRange && enhancedTrailPoints?.length) {
			// enhancedTrailPoints is already sorted by distanceFromStart - no sort needed.
			const segment = enhancedTrailPoints.filter(
				(p) =>
					p.distanceFromStart >= rulerRange.distanceFromStartA && p.distanceFromStart <= rulerRange.distanceFromStartB,
			);
			if (segment.length < 2) return null;
			const filename = tGpx('filenameSegment');
			if (rawGpxData) {
				return {
					gpx: extractGpxSegment(rawGpxData, segment[0].index, segment[segment.length - 1].index, filename),
					filename,
				};
			}
			return {
				gpx: buildGpxXml(
					segment.map((p) => ({ lat: p.lat, lng: p.lng, elevation: p.elevation })),
					filename,
				),
				filename,
			};
		}
		return null;
	};

	const handleGpxConfirm = (): void => {
		const payload = buildGpxPayload();
		if (payload) downloadGpxFile(payload.gpx, payload.filename);
	};

	const handleGpxShare = (): void => {
		const payload = buildGpxPayload();
		if (!payload) return;
		void shareGpxFile(payload.gpx, payload.filename).then((handled) => {
			// Unsupported or hard failure: fall back to a regular download so
			// the user's acknowledged intent still completes.
			if (!handled) downloadGpxFile(payload.gpx, payload.filename);
		});
	};

	return (
		<>
			<div
				className={`flex flex-col overflow-hidden rounded bg-white p-4 shadow outline-none focus:outline-none focus-visible:outline-none dark:border dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)] [&_*]:ring-0 [&_*]:outline-none [&_*]:focus:ring-0 [&_*]:focus:outline-none [&_*]:focus-visible:outline-none ${className} transition-[height] duration-300 ease-in-out motion-reduce:transition-none ${isExpanded ? 'h-[400px]' : 'h-[120px] min-h-[120px] sm:h-[100px] sm:min-h-[100px]'}`}
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
					<div className="flex items-center gap-1.5">
						<h2 className="text-cldt-blue-contrast mb-0 text-base font-semibold sm:text-lg dark:text-[var(--text-primary)]">
							{t('title')}
						</h2>
						<span
							className="hover:text-cldt-blue dark:hover:text-cldt-blue inline-flex shrink-0 cursor-help items-center text-gray-400 dark:text-[var(--text-secondary)] print:hidden"
							onClick={(e) => e.stopPropagation()}
							onMouseDown={(e) => e.stopPropagation()}
						>
							<Tooltip
								content={
									<div className="max-w-[220px] space-y-1 text-left text-xs">
										<div className="font-medium text-gray-800 dark:text-[var(--text-primary)]">
											{tControls('helpTitle')}
										</div>
										<ul className="list-inside list-disc space-y-0.5 text-gray-600 dark:text-[var(--text-secondary)]">
											<li>{tControls('helpItems.trailClick')}</li>
											<li>{tControls('helpItems.chartHover')}</li>
											<li>{tControls('helpItems.chartClickPin')}</li>
											<li>{tControls('helpItems.chartDragRuler')}</li>
											<li>
												{tControls.rich('helpItems.escCancelRuler', {
													kbd: (chunks) => (
														<kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-[11px] text-gray-700 dark:border-[var(--border-color)] dark:bg-[var(--bg-primary)] dark:text-[var(--text-primary)]">
															{chunks}
														</kbd>
													),
												})}
											</li>
										</ul>
									</div>
								}
								offset={6}
								position="bottom"
							>
								<IoHelpCircleOutline aria-hidden className="h-4 w-4" />
							</Tooltip>
						</span>
					</div>
					<div className="flex items-center gap-2 print:hidden">
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
						{gpxLoaded && (
							<Button
								size="sm"
								variant="base"
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									openGpxModal('full');
								}}
								onMouseDown={(e) => e.stopPropagation()}
							>
								<IoDownloadOutline aria-hidden className="mr-1 h-3.5 w-3.5" />
								{tGpx('downloadFull')}
							</Button>
						)}
						<div aria-hidden className="text-cldt-blue-contrast shrink-0 text-xl dark:text-[var(--text-primary)]">
							{isExpanded ? <MdKeyboardArrowUp /> : <MdKeyboardArrowDown />}
						</div>
					</div>
				</div>

				<div
					className={`my-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-700 sm:flex sm:flex-wrap sm:gap-x-4 sm:text-sm dark:text-[var(--text-primary)]${rulerRange ? 'print:hidden' : ''}`}
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
				{rulerStats && (
					<div
						className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 rounded bg-[var(--cldt-green)]/10 px-2 py-1 text-xs text-[color:var(--cldt-green)] sm:text-sm dark:bg-[var(--cldt-green)]/15"
						onClick={toggleExpanded}
					>
						<span className="truncate font-medium">{t('rulerSegment')}:</span>
						<span className="truncate">{formatDistance(rulerStats.distanceKm, units, distancePrecision)}</span>
						<span className="truncate">
							{t('gain')}: {formatElevation(rulerStats.gain, units)}
						</span>
						<span className="truncate">
							{t('loss')}: {formatElevation(rulerStats.loss, units)}
						</span>
						<span className="truncate">
							{t('rulerHikingTime')}: {formatHikingTime(rulerStats.hikingTimeMin)}
						</span>
						{rulerStats.sections.length > 0 && (
							<span className="truncate">
								{t('rulerSection')}: {rulerStats.sections.map((k) => tTrail(k)).join(' → ')}
							</span>
						)}
						<Button
							className="ml-auto shrink-0 print:hidden"
							size="sm"
							variant="base"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								openGpxModal('segment');
							}}
							onMouseDown={(e) => e.stopPropagation()}
						>
							<IoDownloadOutline aria-hidden className="mr-1 h-3.5 w-3.5" />
							{tGpx('exportSegment')}
						</Button>
					</div>
				)}
				{isExpanded && (
					<div
						className={`min-h-[200px] flex-1${rulerRange ? 'print:hidden' : ''}`}
						ref={chartAreaRef}
						role="presentation"
						onMouseDownCapture={handleChartMouseDownCapture}
						onTouchStartCapture={stopMapInteractionTouch}
					>
						<ResponsiveContainer height="100%" minHeight={200} width="100%">
							<AreaChart data={enrichedChartData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
								<RechartsTooltip
									content={(props) => (
										<ChartTooltipSync
											active={props.active && !rulerRange}
											clearTrailHighlight={clearTrailHighlight}
											coordinate={props.coordinate}
											distanceLabel={t('distanceLabel')}
											distancePrecision={distancePrecision}
											elevationLabel={t('elevationLabel')}
											elevationUnitASL={tControls('elevationUnitASL')}
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
									domain={['dataMin', 'dataMax']}
									label={{
										value: units === 'metric' ? t('distanceKm') : t('distanceMi'),
										position: 'insideBottomRight',
										offset: -5,
										fill: axisTextColor,
									}}
									tick={{ fill: axisTextColor }}
									tickFormatter={(value) => formatDistance(value, units, distancePrecision)}
									type="number"
								/>
								<YAxis
									domain={yDomain}
									label={{
										value: units === 'metric' ? t('elevationM') : t('elevationFt'),
										angle: -90,
										position: 'insideLeft',
										fill: axisTextColor,
									}}
									tick={{ fill: axisTextColor }}
									tickFormatter={(value) => formatElevation(value, units)}
								/>
								{fillMode === 'surface' ? (
									SURFACE_BUCKETS.map((b) => (
										<Area
											connectNulls={false}
											dataKey={`elev_${b}`}
											dot={false}
											fill={SURFACE_COLORS[b]}
											fillOpacity={0.7}
											key={b}
											stroke="var(--cldt-blue)"
											type="monotone"
										/>
									))
								) : fillMode === 'sac' ? (
									SAC_BUCKETS.map((b) => (
										<Area
											connectNulls={false}
											dataKey={`elev_${b}`}
											dot={false}
											fill={SAC_COLORS[b]}
											fillOpacity={0.7}
											key={b}
											stroke="var(--cldt-blue)"
											type="monotone"
										/>
									))
								) : fillMode === 'sections' ? (
									SECTION_BUCKETS.map((b) => (
										<Area
											connectNulls={false}
											dataKey={`elev_${b}`}
											dot={false}
											fill={SECTION_COLOR_BY_KEY[b]}
											fillOpacity={0.7}
											key={b}
											stroke="var(--cldt-blue)"
											type="monotone"
										/>
									))
								) : fillMode === 'grade' ? (
									GRADE_BUCKETS.map((b) => (
										<Area
											connectNulls={false}
											dataKey={`elev_${b}`}
											dot={false}
											fill={gradeColorForKey(b)}
											fillOpacity={0.7}
											key={b}
											stroke="var(--cldt-blue)"
											type="monotone"
										/>
									))
								) : (
									<Area
										activeDot={{ r: 6, fill: 'var(--cldt-green)' }}
										dataKey="elevation"
										dot={false}
										fill="var(--cldt-light-blue)"
										stroke="var(--cldt-blue)"
										type="monotone"
									/>
								)}
								{highlightedPoint && (
									<>
										<ReferenceLine
											stroke={pinnedPoint !== null ? 'var(--cldt-blue)' : 'var(--cldt-green)'}
											strokeDasharray={pinnedPoint !== null ? undefined : '3 3'}
											strokeWidth={pinnedPoint !== null ? 3 : 2}
											x={highlightedPoint.distance}
										/>
										{pinnedPoint !== null && (
											<ReferenceDot
												fill="var(--cldt-blue)"
												r={6}
												stroke="white"
												strokeWidth={2}
												x={highlightedPoint.distance}
												y={highlightedPoint.elevation}
											/>
										)}
									</>
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
			<GpxDownloadModal
				isOpen={gpxModalOpen}
				onClose={() => setGpxModalOpen(false)}
				onConfirm={handleGpxConfirm}
				onShare={handleGpxShare}
			/>
		</>
	);
}
