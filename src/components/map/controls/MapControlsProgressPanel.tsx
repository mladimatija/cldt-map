'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useTranslations } from 'next-intl';
import {
	IoAddOutline,
	IoCheckmarkOutline,
	IoCloseOutline,
	IoCloudUploadOutline,
	IoDownloadOutline,
	IoMapOutline,
	IoRemoveOutline,
	IoTrashOutline,
} from 'react-icons/io5';
import { type MultiValue } from 'react-select';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import {
	completedKmInRange,
	intervalsFromKms,
	totalCompletedKm,
	IMPORT_MAX_OFF_TRAIL_M,
	additionalKmFromIntervals,
} from '@/lib/completion';
import { buildGpxWaypointXml, downloadGpxFile, type GpxWaypoint } from '@/lib/gpx-export';
import { newId } from '@/lib/user-waypoints';
import {
	normalizeWaypointCategory,
	waypointCategoryDef,
	waypointCategoryPinColor,
	isWaypointCategoryVisible,
	WAYPOINT_CATEGORIES,
	type WaypointCategoryId,
} from '@/lib/waypoint-categories';
import { displayTrailKm } from '@/lib/journal-track-link';
import { cn, formatDistance } from '@/lib/utils';
import { parseGpxWaypoints, gpxWaypointsToUserWaypoints } from '@/lib/user-waypoint-import';
import { TRAIL_SECTIONS } from '@/lib/trail-sections';
import { buildSpatialGrid } from '@/lib/spatial-grid';
import { computeTrackStats, trackBounds, trackOnTrailKms } from '@/lib/imported-tracks';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { MAP_CONTROL_PANEL_WIDTH, MAP_CONTROL_POPOVER } from './map-controls-constants';
import { MapControlMultiSelect, MapControlSelectColorDotLabel } from './MapControlSelect';
import { MapControlIconButton } from './MapControlIconButton';
import { JournalSection } from './JournalSection';
import { MapControlSectionCard } from './MapControlSectionCard';
import { usePopoverFocusTrap } from '@/hooks';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';

type WaypointCategoryOption = { value: WaypointCategoryId; label: string };

/**
 * Section completion tracking panel: overall and per-section progress,
 * manual marking via the ruler selection or whole sections, one-click import
 * of an imported GPX track's on-trail coverage, and the auto-track / overlay
 * toggles. All mutations go through the persisted interval set in the store.
 */
export function MapControlsProgressPanel(): React.ReactElement | null {
	const t = useTranslations('progress');
	const tWaypoints = useTranslations('waypoints');
	const tRoute = useTranslations('trailRoute');

	const completedIntervals = useMapStore((s: MapStoreState) => s.completedIntervals);
	const markCompleted = useMapStore((s: MapStoreState) => s.markCompleted);
	const unmarkCompleted = useMapStore((s: MapStoreState) => s.unmarkCompleted);
	const clearCompletion = useMapStore((s: MapStoreState) => s.clearCompletion);
	const completionAutoTrack = useMapStore((s: MapStoreState) => s.completionAutoTrack);
	const setCompletionAutoTrack = useMapStore((s: MapStoreState) => s.setCompletionAutoTrack);
	const showCompletionOverlay = useMapStore((s: MapStoreState) => s.showCompletionOverlay);
	const setShowCompletionOverlay = useMapStore((s: MapStoreState) => s.setShowCompletionOverlay);
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);
	const direction = useMapStore((s: MapStoreState) => s.direction);
	const rulerRange = useMapStore((s: MapStoreState) => s.rulerRange);
	const importedTracks = useMapStore((s: MapStoreState) => s.importedTracks);
	const progressTrackIds = useMapStore((s: MapStoreState) => s.progressTrackIds);
	const addProgressTrackId = useMapStore((s: MapStoreState) => s.addProgressTrackId);
	const removeProgressTrackId = useMapStore((s: MapStoreState) => s.removeProgressTrackId);
	const progressPreviewTrackId = useMapStore((s: MapStoreState) => s.progressPreviewTrackId);
	const setProgressPreview = useMapStore((s: MapStoreState) => s.setProgressPreview);
	const progressPanelWaypointsOpen = useMapStore((s: MapStoreState) => s.progressPanelWaypointsOpen);
	const setProgressPanelWaypointsOpen = useMapStore((s: MapStoreState) => s.setProgressPanelWaypointsOpen);
	const progressPanelJournalOpen = useMapStore((s: MapStoreState) => s.progressPanelJournalOpen);
	const setProgressPanelJournalOpen = useMapStore((s: MapStoreState) => s.setProgressPanelJournalOpen);
	const openSettingsToImports = useMapStore((s: MapStoreState) => s.openSettingsToImports);

	const userWaypoints = useMapStore((s: MapStoreState) => s.userWaypoints);
	const hiddenWaypointCategories = useMapStore((s: MapStoreState) => s.hiddenWaypointCategories);
	const setHiddenWaypointCategories = useMapStore((s: MapStoreState) => s.setHiddenWaypointCategories);
	const addUserWaypoint = useMapStore((s: MapStoreState) => s.addUserWaypoint);
	const removeUserWaypoint = useMapStore((s: MapStoreState) => s.removeUserWaypoint);
	const requestOpenWaypoint = useMapStore((s: MapStoreState) => s.requestOpenWaypoint);

	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);
	const totalKm = useStore((s: StoreState) => s.trailMetadata.totalDistance);

	const popoverRef = usePopoverFocusTrap(true);
	const map = useMap();

	const fitToTrack = (track: (typeof importedTracks)[number]): void => {
		const bounds = trackBounds(track);
		if (bounds) map.fitBounds(L.latLngBounds(bounds[0], bounds[1]), { padding: [20, 20] });
	};
	const [confirmClear, setConfirmClear] = useState(false);
	const [previewCoveragePercent, setPreviewCoveragePercent] = useState<number | null>(null);
	const [waypointImportError, setWaypointImportError] = useState<string | null>(null);
	const [waypointListFilter, setWaypointListFilter] = useState<Set<WaypointCategoryId>>(new Set());
	const waypointImportInputRef = useRef<HTMLInputElement>(null);

	const SNAP_MAX_M = 2000;

	const doneKm = useMemo(
		() => Math.min(totalCompletedKm(completedIntervals), totalKm || Infinity),
		[completedIntervals, totalKm],
	);
	const pct = totalKm > 0 ? Math.min(100, (doneKm / totalKm) * 100) : 0;
	const remainingKm = Math.max(0, totalKm - doneKm);

	const animatedDoneKm = useAnimatedNumber(doneKm);
	const animatedRemainingKm = useAnimatedNumber(remainingKm);
	const animatedPct = useAnimatedNumber(pct);

	const fmt = (km: number): string => formatDistance(km, units, distancePrecision);
	const fmtDisplayKm = (soboKm: number): string => fmt(displayTrailKm(soboKm, direction, totalKm));

	const filteredWaypoints = useMemo(() => {
		if (waypointListFilter.size === 0) return userWaypoints;
		return userWaypoints.filter((wp) => waypointListFilter.has(normalizeWaypointCategory(wp.category)));
	}, [userWaypoints, waypointListFilter]);

	const waypointCategoryOptions = useMemo(
		(): WaypointCategoryOption[] =>
			WAYPOINT_CATEGORIES.map((cat) => ({
				value: cat.id,
				label: tWaypoints(`category.${cat.id}`),
			})),
		[tWaypoints],
	);

	const selectedWaypointFilter = useMemo(
		(): WaypointCategoryOption[] => waypointCategoryOptions.filter((o) => waypointListFilter.has(o.value)),
		[waypointCategoryOptions, waypointListFilter],
	);

	const selectedWaypointMapLayers = useMemo((): WaypointCategoryOption[] => {
		if (hiddenWaypointCategories.size === 0) return [];
		return waypointCategoryOptions.filter((o) => !hiddenWaypointCategories.has(o.value));
	}, [waypointCategoryOptions, hiddenWaypointCategories]);

	const sections = useMemo(
		() =>
			TRAIL_SECTIONS.map((s) => {
				const endKm = Number.isFinite(s.endKm) ? s.endKm : totalKm;
				const lengthKm = Math.max(0, endKm - s.startKm);
				const sectionDoneKm = completedKmInRange(completedIntervals, s.startKm, endKm);
				return { ...s, endKm, lengthKm, doneKm: sectionDoneKm };
			}),
		[completedIntervals, totalKm],
	);

	const rulerKms = useMemo((): { lo: number; hi: number } | null => {
		if (!rulerRange) return null;
		const a = rulerRange.distanceFromStartA / 1000;
		const b = rulerRange.distanceFromStartB / 1000;
		return { lo: Math.min(a, b), hi: Math.max(a, b) };
	}, [rulerRange]);

	const rulerMarked = useMemo((): boolean => {
		if (!rulerKms) return false;
		const span = rulerKms.hi - rulerKms.lo;
		if (span <= 0) return false;
		return completedKmInRange(completedIntervals, rulerKms.lo, rulerKms.hi) >= span * 0.999;
	}, [completedIntervals, rulerKms]);

	const [addableById, setAddableById] = useState<Record<string, boolean>>({});
	// Build the trail spatial grid once per trail-points change and reuse it for
	// every coverage lookup (effect below + the render-time preview), instead of
	// rebuilding the full grid inside each trackOnTrailKms call.
	const coverageGrid = useMemo(
		() => (enhancedTrailPoints.length > 0 ? buildSpatialGrid(enhancedTrailPoints) : null),
		[enhancedTrailPoints],
	);
	const coverageRunRef = useRef(0);
	useEffect(() => {
		const runId = ++coverageRunRef.current;
		if (importedTracks.length === 0 || enhancedTrailPoints.length === 0) return;
		const grid = coverageGrid ?? buildSpatialGrid(enhancedTrailPoints);
		let i = 0;
		const tick = (): void => {
			if (runId !== coverageRunRef.current || i >= importedTracks.length) return;
			const track = importedTracks[i];
			computeTrackStats(track, enhancedTrailPoints, grid);
			const addable =
				intervalsFromKms(trackOnTrailKms(track, enhancedTrailPoints, IMPORT_MAX_OFF_TRAIL_M, grid)).length > 0;
			setAddableById((prev) => (prev[track.id] === addable ? prev : { ...prev, [track.id]: addable }));
			i++;
			if (i < importedTracks.length) setTimeout(tick, 0);
		};
		const start = setTimeout(tick, 0);
		return () => clearTimeout(start);
	}, [importedTracks, enhancedTrailPoints, coverageGrid]);

	const trackIntervals = (track: (typeof importedTracks)[number]): { startKm: number; endKm: number }[] => {
		if (enhancedTrailPoints.length === 0) return [];
		return intervalsFromKms(
			trackOnTrailKms(track, enhancedTrailPoints, IMPORT_MAX_OFF_TRAIL_M, coverageGrid ?? undefined),
		);
	};

	const handleRemoveTrack = (trackId: string): void => {
		const track = importedTracks.find((tr) => tr.id === trackId);
		if (!track) return;
		const intervals = trackIntervals(track);
		if (intervals.length === 0) return;
		for (const iv of intervals) {
			unmarkCompleted(iv.startKm, iv.endKm);
		}
		removeProgressTrackId(trackId);
	};

	const clearPreview = (): void => {
		setPreviewCoveragePercent(null);
		setProgressPreview(null, []);
	};

	const handleStartPreview = (trackId: string): void => {
		const track = importedTracks.find((tr) => tr.id === trackId);
		if (!track) return;
		const intervals = trackIntervals(track);
		if (intervals.length === 0) return;
		setProgressPreview(trackId, intervals);
		if (enhancedTrailPoints.length > 0) {
			const stats = computeTrackStats(track, enhancedTrailPoints);
			setPreviewCoveragePercent(stats.coveragePercent);
		} else {
			setPreviewCoveragePercent(null);
		}
		fitToTrack(track);
	};

	const handleConfirmAddTrack = (trackId: string): void => {
		const track = importedTracks.find((tr) => tr.id === trackId);
		if (!track) return;
		const intervals = trackIntervals(track);
		if (intervals.length === 0) return;
		for (const iv of intervals) {
			markCompleted(iv.startKm, iv.endKm);
		}
		addProgressTrackId(trackId);
		clearPreview();
	};

	const handleExportWaypoints = (): void => {
		if (userWaypoints.length === 0) return;
		const waypoints: GpxWaypoint[] = userWaypoints.map((w) => {
			const def = waypointCategoryDef(w.category);
			return {
				lat: w.lat,
				lng: w.lng,
				name: w.name,
				description: w.note || undefined,
				type: def.gpxType,
				sym: def.gpxSym,
			};
		});
		downloadGpxFile(buildGpxWaypointXml(waypoints, t('waypointsHeading')), 'cldt-my-waypoints.gpx');
	};

	const snapTrailKm = (lat: number, lng: number): number | null => {
		const snapped = useStore.getState().findTrailPointByCoordinates(lat, lng, SNAP_MAX_M);
		return snapped ? snapped.distanceFromStart / 1000 : null;
	};

	const mapWaypointImportError = (code: string): string => {
		switch (code) {
			case 'FILE_TOO_LARGE':
				return t('importWaypointsTooLarge');
			case 'UNSUPPORTED_DOCTYPE':
			case 'MALFORMED':
			case 'NO_WAYPOINTS':
				return t('importWaypointsError');
			default:
				return t('importWaypointsError');
		}
	};

	const handleImportWaypointsFile = async (file: File): Promise<void> => {
		setWaypointImportError(null);
		try {
			const parsed = parseGpxWaypoints(await file.text());
			const imported = gpxWaypointsToUserWaypoints(parsed, useMapStore.getState().userWaypoints, {
				newId,
				snapTrailKm,
			});
			for (const wp of imported) addUserWaypoint(wp);
		} catch (err) {
			const code = err instanceof Error ? err.message : '';
			setWaypointImportError(mapWaypointImportError(code));
		}
	};

	const popoverContent = (
		<div
			aria-labelledby="progress-panel-title"
			aria-modal="true"
			className={cn(
				`z-controls-popover fixed top-2 right-16 flex max-h-[calc(100dvh-4rem)] ${MAP_CONTROL_PANEL_WIDTH} flex-col gap-2 overflow-hidden`,
				MAP_CONTROL_POPOVER,
			)}
			ref={popoverRef}
			role="dialog"
			onContextMenu={(e) => e.preventDefault()}
			onMouseDown={(e) => e.stopPropagation()}
			onTouchStart={(e) => e.stopPropagation()}
		>
			<h3
				className="shrink-0 text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]"
				id="progress-panel-title"
			>
				{t('title')}
			</h3>

			<div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
				<div className="sticky top-0 z-[1] -mx-1 mb-2 border-b border-gray-200 bg-white px-1 pb-2 dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)]">
					<div className="text-xs text-gray-700 dark:text-[var(--text-primary)]">
						<p className="m-0 text-base font-semibold text-gray-900 dark:text-white">
							{t.rich('completedLine', {
								done: (chunks) => <span className="tabular-nums">{chunks}</span>,
								total: (chunks) => <span className="tabular-nums">{chunks}</span>,
								pct: (chunks) => (
									<span className="text-cldt-green tabular-nums transition-colors duration-150 motion-reduce:transition-none">
										{chunks}
									</span>
								),
								doneKm: fmt(animatedDoneKm),
								totalKm: fmt(totalKm),
								pctValue: animatedPct.toFixed(1),
							})}
						</p>
						<p className="m-0 text-gray-500 dark:text-[var(--text-secondary)]">
							{t.rich('remainingLine', {
								distance: (chunks) => <span className="tabular-nums">{chunks}</span>,
								remainingKm: fmt(animatedRemainingKm),
							})}
						</p>
						<div
							aria-hidden
							className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-[var(--bg-hover)]"
						>
							<div
								className="bg-cldt-green h-full rounded-full transition-[width] duration-150 ease-out motion-reduce:transition-none"
								style={{ width: `${pct}%` }}
							/>
						</div>
					</div>
					<div className="mt-2 flex flex-col gap-1.5">
						<label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
							<Checkbox checked={completionAutoTrack} onCheckedChange={(checked) => setCompletionAutoTrack(checked)} />
							{t('autoTrack')}
						</label>
						<label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
							<Checkbox
								checked={showCompletionOverlay}
								onCheckedChange={(checked) => setShowCompletionOverlay(checked)}
							/>
							{t('showOverlay')}
						</label>
					</div>
				</div>

				<div className="flex flex-col gap-3">
					<MapControlSectionCard title={t('yourProgressHeading')}>
						<div className="flex flex-col gap-1">
							<p className="m-0 text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
								{t('sectionsHeading')}
							</p>
							{sections.map((s) => {
								const sectionPct = s.lengthKm > 0 ? (s.doneKm / s.lengthKm) * 100 : 0;
								const complete = sectionPct >= 99.9;
								return (
									<label className="flex min-w-0 cursor-pointer items-center gap-2 text-xs" key={s.shortName}>
										<Checkbox
											aria-label={complete ? t('unmarkSection') : t('markSection')}
											checked={complete}
											onCheckedChange={(checked) =>
												checked ? markCompleted(s.startKm, s.endKm) : unmarkCompleted(s.startKm, s.endKm)
											}
										/>
										<span className="w-5 shrink-0 font-semibold" style={{ color: s.color }}>
											{s.shortName}
										</span>
										<span className="min-w-0 flex-1 truncate text-gray-600 dark:text-[var(--text-primary)]">
											{tRoute(s.nameKey)} · {sectionPct.toFixed(0)}%
										</span>
									</label>
								);
							})}
						</div>

						{rulerKms ? (
							<div className="border-t border-gray-200 pt-2 dark:border-[var(--border-color)]">
								<p className="m-0 text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
									{t('rulerHeading')}
								</p>
								<label className="mt-1 flex min-w-0 cursor-pointer items-center gap-2 text-xs">
									<Checkbox
										aria-label={rulerMarked ? t('unmarkRange') : t('markRange')}
										checked={rulerMarked}
										onCheckedChange={(checked) =>
											checked ? markCompleted(rulerKms.lo, rulerKms.hi) : unmarkCompleted(rulerKms.lo, rulerKms.hi)
										}
									/>
									<span className="min-w-0 flex-1 truncate text-gray-600 dark:text-[var(--text-primary)]">
										{fmtDisplayKm(rulerKms.lo)} - {fmtDisplayKm(rulerKms.hi)}
									</span>
								</label>
							</div>
						) : null}
					</MapControlSectionCard>

					<MapControlSectionCard title={t('fromGpxHeading')}>
						{importedTracks.length > 0 ? (
							importedTracks.map((track) => {
								const isPreviewing = progressPreviewTrackId === track.id;
								const previewIntervals = isPreviewing ? trackIntervals(track) : [];
								const previewOnTrailKm = totalCompletedKm(previewIntervals);
								const previewNewKm = additionalKmFromIntervals(completedIntervals, previewIntervals);
								return (
									<div className="flex flex-col gap-1.5" key={track.id}>
										<div className="flex min-w-0 items-center gap-2 text-xs">
											<span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: track.color }} />
											<button
												className="hover:text-cldt-blue focus-visible:ring-cldt-green min-w-0 flex-1 cursor-pointer truncate rounded border-0 bg-transparent p-0 text-left text-gray-600 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 dark:text-[var(--text-primary)]"
												title={track.name}
												type="button"
												onClick={() => fitToTrack(track)}
											>
												{track.name}
											</button>
											{addableById[track.id] === false && !progressTrackIds.includes(track.id) ? (
												<SmartTooltip content={t('trackNoCoverage')} position="top">
													<span className="inline-flex shrink-0">
														<MapControlIconButton disabled aria-label={t('addTrack')}>
															<IoAddOutline aria-hidden className="h-3.5 w-3.5" />
														</MapControlIconButton>
													</span>
												</SmartTooltip>
											) : progressTrackIds.includes(track.id) ? (
												<MapControlIconButton aria-label={t('removeTrack')} onClick={() => handleRemoveTrack(track.id)}>
													<IoRemoveOutline aria-hidden className="h-3.5 w-3.5" />
												</MapControlIconButton>
											) : isPreviewing ? (
												<MapControlIconButton
													aria-label={t('previewCancel')}
													variant="mapControlOutlineSecondary"
													onClick={clearPreview}
												>
													<IoCloseOutline aria-hidden className="h-3.5 w-3.5" />
												</MapControlIconButton>
											) : (
												<MapControlIconButton aria-label={t('addTrack')} onClick={() => handleStartPreview(track.id)}>
													<IoAddOutline aria-hidden className="h-3.5 w-3.5" />
												</MapControlIconButton>
											)}
										</div>
										{isPreviewing && previewIntervals.length > 0 && (
											<div
												aria-labelledby={`progress-preview-${track.id}`}
												className="rounded border border-amber-200 bg-amber-50/80 p-2 pl-5 text-xs dark:border-amber-900/50 dark:bg-amber-950/30"
												role="region"
											>
												<p
													className="m-0 font-medium text-gray-700 dark:text-[var(--text-primary)]"
													id={`progress-preview-${track.id}`}
												>
													{t('previewPrompt')}
												</p>
												<p className="m-0 mt-1 text-gray-600 dark:text-[var(--text-primary)]">
													{t('previewSummary', {
														count: previewIntervals.length,
														distance: fmt(previewOnTrailKm),
													})}
													{previewCoveragePercent !== null && (
														<> · {t('previewCoverage', { percent: previewCoveragePercent.toFixed(0) })}</>
													)}
												</p>
												{previewNewKm < previewOnTrailKm - 0.05 && (
													<p className="m-0 mt-0.5 text-gray-500 dark:text-[var(--text-secondary)]">
														{t('previewNewKm', { distance: fmt(previewNewKm) })}
													</p>
												)}
												<ul className="m-0 mt-1.5 max-h-24 list-none space-y-0.5 overflow-y-auto p-0 text-gray-600 dark:text-[var(--text-primary)]">
													{previewIntervals.map((iv) => (
														<li key={`${iv.startKm}-${iv.endKm}`}>
															{t('previewRange', { start: fmt(iv.startKm), end: fmt(iv.endKm) })}
														</li>
													))}
												</ul>
												<div className="mt-2 flex flex-wrap items-center gap-2">
													<MapControlIconButton
														aria-label={t('previewConfirm')}
														variant="mapControlOutline"
														onClick={() => handleConfirmAddTrack(track.id)}
													>
														<IoCheckmarkOutline aria-hidden className="h-3.5 w-3.5" />
													</MapControlIconButton>
													<MapControlIconButton
														aria-label={t('previewCancel')}
														variant="mapControlOutlineSecondary"
														onClick={clearPreview}
													>
														<IoCloseOutline aria-hidden className="h-3.5 w-3.5" />
													</MapControlIconButton>
													<MapControlIconButton
														aria-label={t('previewShowOnMap')}
														variant="mapControlOutlineSecondary"
														onClick={() => fitToTrack(track)}
													>
														<IoMapOutline aria-hidden className="h-3.5 w-3.5" />
													</MapControlIconButton>
												</div>
											</div>
										)}
									</div>
								);
							})
						) : (
							<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('noTracks')}</p>
						)}
						<button
							className="text-cldt-blue focus-visible:ring-cldt-green mt-1 cursor-pointer rounded border-0 bg-transparent p-0 text-left text-xs underline outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
							type="button"
							onClick={openSettingsToImports}
						>
							{t('manageTracksInSettings')}
						</button>
					</MapControlSectionCard>

					<MapControlSectionCard
						collapsible
						collapseLabel={t('collapseSection')}
						expandLabel={t('expandSection')}
						open={progressPanelWaypointsOpen}
						title={t('waypointsHeading')}
						onOpenChange={setProgressPanelWaypointsOpen}
					>
						{userWaypoints.length === 0 ? (
							<>
								<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('noWaypoints')}</p>
								<MapControlIconButton
									aria-label={t('importWaypoints')}
									variant="mapControlOutlineSecondary"
									onClick={() => waypointImportInputRef.current?.click()}
								>
									<IoCloudUploadOutline aria-hidden className="h-3.5 w-3.5" />
								</MapControlIconButton>
							</>
						) : (
							<>
								<div className="flex flex-col gap-1">
									<p className="m-0 text-[0.625rem] text-gray-500 dark:text-[var(--text-secondary)]">
										{tWaypoints('filterHeading')}
									</p>
									<div className="relative w-full min-w-0">
										<MapControlMultiSelect<WaypointCategoryOption>
											aria-label={tWaypoints('filterHeading')}
											chipLayout="scroll"
											formatOptionLabel={(option) => (
												<MapControlSelectColorDotLabel
													color={waypointCategoryPinColor(option.value)}
													label={option.label}
												/>
											)}
											isSearchable={false}
											options={waypointCategoryOptions}
											placeholder={tWaypoints('filterPlaceholder')}
											value={selectedWaypointFilter}
											onChange={(val: MultiValue<WaypointCategoryOption>) => {
												setWaypointListFilter(new Set(val.map((o) => o.value)));
											}}
										/>
									</div>
								</div>
								<div className="flex flex-col gap-1">
									<p className="m-0 text-[0.625rem] text-gray-500 dark:text-[var(--text-secondary)]">
										{tWaypoints('mapLayersHeading')}
									</p>
									<div className="relative w-full min-w-0">
										<MapControlMultiSelect<WaypointCategoryOption>
											aria-label={tWaypoints('mapLayersHeading')}
											chipLayout="scroll"
											formatOptionLabel={(option) => (
												<MapControlSelectColorDotLabel
													color={waypointCategoryPinColor(option.value)}
													label={option.label}
												/>
											)}
											isSearchable={false}
											options={waypointCategoryOptions}
											placeholder={tWaypoints('mapLayersPlaceholder')}
											value={selectedWaypointMapLayers}
											onChange={(val: MultiValue<WaypointCategoryOption>) => {
												if (val.length === 0) {
													setHiddenWaypointCategories(new Set());
													return;
												}
												const visible = new Set(val.map((o) => o.value));
												const hidden = new Set(
													WAYPOINT_CATEGORIES.filter((cat) => !visible.has(cat.id)).map((cat) => cat.id),
												);
												setHiddenWaypointCategories(hidden);
											}}
										/>
									</div>
								</div>
								<div className="border-t border-gray-200 pt-2 dark:border-[var(--border-color)]">
									{waypointListFilter.size > 0 && filteredWaypoints.length === 0 ? (
										<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
											{tWaypoints('filterEmpty')}
										</p>
									) : null}
									<div className="flex flex-col gap-1.5">
										{filteredWaypoints.map((wp) => {
											const category = normalizeWaypointCategory(wp.category);
											const hiddenOnMap = !isWaypointCategoryVisible(category, hiddenWaypointCategories);
											return (
												<div
													className={cn('flex min-w-0 items-center gap-2 text-xs', hiddenOnMap && 'opacity-60')}
													key={wp.id}
												>
													<span
														aria-hidden
														className="h-2 w-2 shrink-0 rounded-full"
														style={{ backgroundColor: waypointCategoryPinColor(category) }}
													/>
													<button
														className="hover:text-cldt-blue min-w-0 flex-1 cursor-pointer truncate text-left text-gray-600 dark:text-[var(--text-primary)]"
														type="button"
														onClick={() => requestOpenWaypoint(wp.id)}
													>
														<span className="font-medium text-gray-700 dark:text-[var(--text-primary)]">{wp.name}</span>
														<span className="text-gray-400 dark:text-[var(--text-secondary)]">
															{' '}
															· {tWaypoints(`category.${category}`)}
														</span>
														{wp.trailKm !== null && (
															<span className="text-gray-400 dark:text-[var(--text-secondary)]">
																{' '}
																· {fmt(wp.trailKm)}
															</span>
														)}
														{hiddenOnMap ? (
															<span className="text-gray-400 dark:text-[var(--text-secondary)]">
																{' '}
																· {tWaypoints('hiddenOnMap')}
															</span>
														) : null}
													</button>
													<MapControlIconButton
														aria-label={t('waypointDelete')}
														onClick={() => removeUserWaypoint(wp.id)}
													>
														<IoTrashOutline aria-hidden className="h-3.5 w-3.5" />
													</MapControlIconButton>
												</div>
											);
										})}
									</div>
									<div className="mt-2 flex flex-wrap gap-2">
										<MapControlIconButton
											aria-label={t('exportWaypoints')}
											variant="mapControlOutlineSecondary"
											onClick={handleExportWaypoints}
										>
											<IoDownloadOutline aria-hidden className="h-3.5 w-3.5" />
										</MapControlIconButton>
										<MapControlIconButton
											aria-label={t('importWaypoints')}
											variant="mapControlOutlineSecondary"
											onClick={() => waypointImportInputRef.current?.click()}
										>
											<IoCloudUploadOutline aria-hidden className="h-3.5 w-3.5" />
										</MapControlIconButton>
									</div>
								</div>
							</>
						)}
						<input
							accept=".gpx,application/gpx+xml"
							className="hidden"
							ref={waypointImportInputRef}
							type="file"
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (file) void handleImportWaypointsFile(file);
								e.target.value = '';
							}}
						/>
						{waypointImportError && <p className="text-cldt-red m-0 text-xs">{waypointImportError}</p>}
					</MapControlSectionCard>

					<MapControlSectionCard
						collapsible
						collapseLabel={t('collapseSection')}
						expandLabel={t('expandSection')}
						open={progressPanelJournalOpen}
						title={t('journalHeading')}
						onOpenChange={setProgressPanelJournalOpen}
					>
						<JournalSection embedded />
					</MapControlSectionCard>

					<div className="border-t border-gray-200 pt-3 dark:border-[var(--border-color)]">
						{!confirmClear ? (
							<Button
								className="w-full"
								disabled={completedIntervals.length === 0}
								size="sm"
								variant="mapControlOutlineSecondary"
								onClick={() => setConfirmClear(true)}
							>
								{t('clear')}
							</Button>
						) : (
							<div className="flex min-w-0 items-center gap-2">
								<span className="min-w-0 flex-1 text-xs text-gray-700 dark:text-[var(--text-primary)]">
									{t('confirmClear')}
								</span>
								<Button
									size="sm"
									variant="mapControlOutline"
									onClick={() => {
										clearCompletion();
										setConfirmClear(false);
									}}
								>
									{t('confirmYes')}
								</Button>
								<Button size="sm" variant="mapControlOutlineSecondary" onClick={() => setConfirmClear(false)}>
									{t('confirmNo')}
								</Button>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);

	return typeof document !== 'undefined' ? createPortal(popoverContent, document.body) : null;
}
