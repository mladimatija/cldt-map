'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { completedKmInRange, intervalsFromKms, totalCompletedKm, IMPORT_MAX_OFF_TRAIL_M } from '@/lib/completion';
import { buildGpxWaypointXml, downloadGpxFile, type GpxWaypoint } from '@/lib/gpx-export';
import { downloadTextFile, journalToMarkdown, newId, todayIsoDate, type JournalEntry } from '@/lib/user-waypoints';
import { TRAIL_SECTIONS } from '@/lib/trail-sections';
import { buildSpatialGrid } from '@/lib/spatial-grid';
import { computeTrackStats } from '@/lib/imported-tracks';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { cn, formatDistance } from '@/lib/utils';
import { IoExpandOutline } from 'react-icons/io5';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { MAP_CONTROL_INPUT, MAP_CONTROL_POPOVER } from './map-controls-constants';
import { usePopoverFocusTrap } from '@/hooks';

/**
 * Section completion tracking panel: overall and per-section progress,
 * manual marking via the ruler selection or whole sections, one-click import
 * of an imported GPX track's on-trail coverage, and the auto-track / overlay
 * toggles. All mutations go through the persisted interval set in the store.
 */
export function MapControlsProgressPanel(): React.ReactElement {
	const t = useTranslations('progress');
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
	const rulerRange = useMapStore((s: MapStoreState) => s.rulerRange);
	const importedTracks = useMapStore((s: MapStoreState) => s.importedTracks);
	const progressTrackIds = useMapStore((s: MapStoreState) => s.progressTrackIds);
	const addProgressTrackId = useMapStore((s: MapStoreState) => s.addProgressTrackId);
	const removeProgressTrackId = useMapStore((s: MapStoreState) => s.removeProgressTrackId);

	const userWaypoints = useMapStore((s: MapStoreState) => s.userWaypoints);
	const removeUserWaypoint = useMapStore((s: MapStoreState) => s.removeUserWaypoint);
	const requestOpenWaypoint = useMapStore((s: MapStoreState) => s.requestOpenWaypoint);
	const journalEntries = useMapStore((s: MapStoreState) => s.journalEntries);
	const addJournalEntry = useMapStore((s: MapStoreState) => s.addJournalEntry);
	const removeJournalEntry = useMapStore((s: MapStoreState) => s.removeJournalEntry);

	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);
	const totalKm = useStore((s: StoreState) => s.trailMetadata.totalDistance);

	const popoverRef = usePopoverFocusTrap(true);
	const [confirmClear, setConfirmClear] = useState(false);
	const [entryDate, setEntryDate] = useState(todayIsoDate);
	const [entryText, setEntryText] = useState('');
	const [attachRuler, setAttachRuler] = useState(false);
	/** Distraction-free overlay editor for the journal entry draft. Shares
	 *  the same draft state as the inline form, so expanding mid-sentence
	 *  keeps the text and saving from either place is equivalent. */
	const [focusEditorOpen, setFocusEditorOpen] = useState(false);

	const doneKm = useMemo(
		() => Math.min(totalCompletedKm(completedIntervals), totalKm || Infinity),
		[completedIntervals, totalKm],
	);
	const pct = totalKm > 0 ? Math.min(100, (doneKm / totalKm) * 100) : 0;

	const fmt = (km: number): string => formatDistance(km, units, distancePrecision);

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

	/** Per-track on-trail coverage (%), computed post-paint one track per
	 *  tick against a shared grid. computeTrackStats memoises by content
	 *  hash, so this is a cache walk after the imports panel has run once.
	 *  Used to disable "Add to progress" for tracks that never touch the
	 *  trail (nothing to add). */
	const [coverageById, setCoverageById] = useState<Record<string, number>>({});
	const coverageRunRef = useRef(0);
	useEffect(() => {
		const runId = ++coverageRunRef.current;
		if (importedTracks.length === 0 || enhancedTrailPoints.length === 0) return;
		const grid = buildSpatialGrid(enhancedTrailPoints);
		let i = 0;
		const tick = (): void => {
			if (runId !== coverageRunRef.current || i >= importedTracks.length) return;
			const track = importedTracks[i];
			const pct = computeTrackStats(track, enhancedTrailPoints, grid).coveragePercent;
			setCoverageById((prev) => (prev[track.id] === pct ? prev : { ...prev, [track.id]: pct }));
			i++;
			if (i < importedTracks.length) setTimeout(tick, 0);
		};
		const start = setTimeout(tick, 0);
		return () => clearTimeout(start);
	}, [importedTracks, enhancedTrailPoints]);

	/** The track's on-trail stretch as completed intervals. The spatial grid
	 *  is built per click - a one-off O(trail) cost is fine for an explicit
	 *  user action. */
	const trackIntervals = (track: (typeof importedTracks)[number]): { startKm: number; endKm: number }[] => {
		if (enhancedTrailPoints.length === 0) return [];
		const grid = buildSpatialGrid(enhancedTrailPoints);
		const kms: number[] = [];
		for (const pt of track.points) {
			const hit = grid.nearest(pt.lat, pt.lng);
			if (hit && hit.distanceM <= IMPORT_MAX_OFF_TRAIL_M) {
				kms.push(enhancedTrailPoints[hit.index].distanceFromStart / 1000);
			}
		}
		return intervalsFromKms(kms);
	};

	/** Toggle: first click folds the track's on-trail stretch into progress,
	 *  second click unmarks that same stretch. Unmarking removes shared km if
	 *  two tracks overlap - completion is a plain interval set, not refcounted. */
	const handleToggleTrack = (trackId: string): void => {
		const track = importedTracks.find((tr) => tr.id === trackId);
		if (!track) return;
		const intervals = trackIntervals(track);
		if (intervals.length === 0) return;
		const added = progressTrackIds.includes(trackId);
		for (const iv of intervals) {
			if (added) unmarkCompleted(iv.startKm, iv.endKm);
			else markCompleted(iv.startKm, iv.endKm);
		}
		if (added) removeProgressTrackId(trackId);
		else addProgressTrackId(trackId);
	};

	const handleExportWaypoints = (): void => {
		if (userWaypoints.length === 0) return;
		const waypoints: GpxWaypoint[] = userWaypoints.map((w) => ({
			lat: w.lat,
			lng: w.lng,
			name: w.name,
			description: w.note || undefined,
		}));
		downloadGpxFile(buildGpxWaypointXml(waypoints, t('waypointsHeading')), 'cldt-my-waypoints.gpx');
	};

	const handleAddEntry = (): void => {
		const text = entryText.trim();
		if (!text) return;
		const entry: JournalEntry = {
			id: newId(),
			date: entryDate || todayIsoDate(),
			text,
			createdAt: new Date().toISOString(),
			...(attachRuler && rulerKms ? { startKm: rulerKms.lo, endKm: rulerKms.hi } : {}),
		};
		addJournalEntry(entry);
		setEntryText('');
		setAttachRuler(false);
	};

	const handleExportJournal = (): void => {
		if (journalEntries.length === 0) return;
		const md = journalToMarkdown(
			journalEntries,
			{ title: t('journalHeading'), rangeLine: (range) => t('journalRangeLine', { range }) },
			(km, u) => formatDistance(km, u, distancePrecision),
			units,
		);
		downloadTextFile(md, 'cldt-journal.md');
	};

	const journalSorted = useMemo(
		() => [...journalEntries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
		[journalEntries],
	);

	return (
		<>
			<div
				aria-labelledby="progress-panel-title"
				aria-modal="true"
				className={`z-controls-popover fixed top-2 right-16 flex max-h-[calc(100dvh-4rem)] w-80 flex-col gap-3 overflow-y-auto ${MAP_CONTROL_POPOVER}`}
				ref={popoverRef}
				role="dialog"
				onContextMenu={(e) => e.preventDefault()}
			>
				<h3 className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]" id="progress-panel-title">
					{t('title')}
				</h3>

				<div className="text-xs text-gray-700 dark:text-gray-300">
					<p className="m-0 text-base font-semibold text-gray-900 dark:text-white">
						{t('completedLine', { done: fmt(doneKm), total: fmt(totalKm), pct: pct.toFixed(1) })}
					</p>
					<p className="m-0 text-gray-500 dark:text-gray-400">
						{t('remainingLine', { distance: fmt(Math.max(0, totalKm - doneKm)) })}
					</p>
					<div aria-hidden className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
						<div className="bg-cldt-green h-full rounded-full" style={{ width: `${pct}%` }} />
					</div>
				</div>

				<div className="flex flex-col gap-1">
					<p className="m-0 text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
						{t('sectionsHeading')}
					</p>
					{sections.map((s) => {
						const sectionPct = s.lengthKm > 0 ? (s.doneKm / s.lengthKm) * 100 : 0;
						const complete = sectionPct >= 99.9;
						return (
							<div className="flex items-center gap-2 text-xs" key={s.shortName}>
								<span className="w-5 shrink-0 font-semibold" style={{ color: s.color }}>
									{s.shortName}
								</span>
								<span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">
									{tRoute(s.nameKey)} · {sectionPct.toFixed(0)}%
								</span>
								<Button
									size="sm"
									variant="base"
									onClick={() => (complete ? unmarkCompleted(s.startKm, s.endKm) : markCompleted(s.startKm, s.endKm))}
								>
									{complete ? t('unmarkSection') : t('markSection')}
								</Button>
							</div>
						);
					})}
				</div>

				<div className="flex flex-col gap-1.5">
					<p className="m-0 text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
						{t('rulerHeading')}
					</p>
					{rulerKms ? (
						<div className="flex items-center gap-2 text-xs">
							<span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">
								{fmt(rulerKms.lo)} - {fmt(rulerKms.hi)}
							</span>
							<Button size="sm" variant="base" onClick={() => markCompleted(rulerKms.lo, rulerKms.hi)}>
								{t('markRange')}
							</Button>
							<Button size="sm" variant="base" onClick={() => unmarkCompleted(rulerKms.lo, rulerKms.hi)}>
								{t('unmarkRange')}
							</Button>
						</div>
					) : (
						<p className="m-0 text-xs text-gray-500 dark:text-gray-400">{t('noRuler')}</p>
					)}
				</div>

				<div className="flex flex-col gap-1.5">
					<p className="m-0 text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
						{t('tracksHeading')}
					</p>
					{importedTracks.length > 0 ? (
						importedTracks.map((track) => (
							<div className="flex items-center gap-2 text-xs" key={track.id}>
								<span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: track.color }} />
								<span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">{track.name}</span>
								{coverageById[track.id] === 0 && !progressTrackIds.includes(track.id) ? (
									<SmartTooltip content={t('trackNoCoverage')} position="top">
										<span className="inline-flex">
											<Button disabled size="sm" variant="base">
												{t('addTrack')}
											</Button>
										</span>
									</SmartTooltip>
								) : (
									<Button size="sm" variant="base" onClick={() => handleToggleTrack(track.id)}>
										{progressTrackIds.includes(track.id) ? t('removeTrack') : t('addTrack')}
									</Button>
								)}
							</div>
						))
					) : (
						<p className="m-0 text-xs text-gray-500 dark:text-gray-400">{t('noTracks')}</p>
					)}
				</div>

				<div className="flex flex-col gap-1.5">
					<p className="m-0 text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
						{t('waypointsHeading')}
					</p>
					{userWaypoints.length > 0 ? (
						<>
							{userWaypoints.map((wp) => (
								<div className="flex items-center gap-2 text-xs" key={wp.id}>
									<span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-violet-600" />
									<button
										className="hover:text-cldt-blue min-w-0 flex-1 cursor-pointer truncate text-left text-gray-600 dark:text-gray-300"
										type="button"
										onClick={() => requestOpenWaypoint(wp.id)}
									>
										{wp.name}
										{wp.trailKm !== null && (
											<span className="text-gray-400 dark:text-gray-500"> · {fmt(wp.trailKm)}</span>
										)}
									</button>
									<Button size="sm" variant="base" onClick={() => removeUserWaypoint(wp.id)}>
										{t('waypointDelete')}
									</Button>
								</div>
							))}
							<Button size="sm" variant="mapControlOutlineSecondary" onClick={handleExportWaypoints}>
								{t('exportWaypoints')}
							</Button>
						</>
					) : (
						<p className="m-0 text-xs text-gray-500 dark:text-gray-400">{t('noWaypoints')}</p>
					)}
				</div>

				<div className="flex flex-col gap-1.5">
					<p className="m-0 text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
						{t('journalHeading')}
					</p>
					{journalSorted.map((e) => (
						<div className="flex items-start gap-2" key={e.id}>
							<div className="min-w-0 flex-1">
								<p className="m-0 text-xs font-medium text-gray-700 dark:text-gray-200">
									{e.date}
									{e.startKm !== undefined && e.endKm !== undefined && (
										<span className="font-normal text-gray-400 dark:text-gray-500">
											{' '}
											· {fmt(e.startKm)} - {fmt(e.endKm)}
										</span>
									)}
								</p>
								<p className="m-0 line-clamp-2 text-xs break-words whitespace-pre-line text-gray-600 dark:text-gray-300">
									{e.text}
								</p>
							</div>
							<Button size="sm" variant="base" onClick={() => removeJournalEntry(e.id)}>
								{t('waypointDelete')}
							</Button>
						</div>
					))}
					{journalSorted.length === 0 && (
						<p className="m-0 text-xs text-gray-500 dark:text-gray-400">{t('noEntries')}</p>
					)}
					<div className="flex flex-col gap-1 rounded border border-gray-100 p-1.5 dark:border-[var(--border-color)]">
						<label className="flex flex-col gap-0.5 text-xs text-gray-600 dark:text-gray-400">
							{t('entryDateLabel')}
							<input
								className={cn(MAP_CONTROL_INPUT, 'w-full')}
								type="date"
								value={entryDate}
								onChange={(e) => setEntryDate(e.target.value)}
							/>
						</label>
						<div className="relative">
							<textarea
								aria-label={t('entryTextLabel')}
								className={cn(MAP_CONTROL_INPUT, 'w-full resize-y pr-8')}
								placeholder={t('entryPlaceholder')}
								rows={4}
								value={entryText}
								onChange={(e) => setEntryText(e.target.value)}
							/>
							<button
								aria-label={t('focusEditor')}
								className="hover:text-cldt-blue focus-visible:ring-cldt-green absolute top-1 right-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-gray-500 outline-none focus-visible:ring-2 dark:text-gray-400"
								title={t('focusEditor')}
								type="button"
								onClick={() => setFocusEditorOpen(true)}
							>
								<IoExpandOutline aria-hidden className="h-4.5 w-4.5" />
							</button>
						</div>
						{rulerKms && (
							<label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
								<Checkbox checked={attachRuler} onCheckedChange={(checked) => setAttachRuler(checked)} />
								{t('attachRuler', { range: `${fmt(rulerKms.lo)} - ${fmt(rulerKms.hi)}` })}
							</label>
						)}
						<div className="flex justify-end gap-2">
							{journalEntries.length > 0 && (
								<Button size="sm" variant="mapControlOutlineSecondary" onClick={handleExportJournal}>
									{t('exportJournal')}
								</Button>
							)}
							<Button disabled={entryText.trim().length === 0} size="sm" variant="base" onClick={handleAddEntry}>
								{t('addEntry')}
							</Button>
						</div>
					</div>
				</div>

				<label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
					<Checkbox checked={completionAutoTrack} onCheckedChange={(checked) => setCompletionAutoTrack(checked)} />
					{t('autoTrack')}
				</label>
				<label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
					<Checkbox checked={showCompletionOverlay} onCheckedChange={(checked) => setShowCompletionOverlay(checked)} />
					{t('showOverlay')}
				</label>

				{!confirmClear ? (
					<Button
						disabled={completedIntervals.length === 0}
						variant="mapControlOutlineSecondary"
						onClick={() => setConfirmClear(true)}
					>
						{t('clear')}
					</Button>
				) : (
					<div className="flex items-center gap-2">
						<span className="flex-1 text-xs text-gray-700 dark:text-gray-300">{t('confirmClear')}</span>
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

			{focusEditorOpen && (
				<div
					aria-labelledby="journal-focus-title"
					aria-modal="true"
					className="z-modal fixed inset-0 flex items-center justify-center bg-[var(--modal-backdrop-bg)] p-4"
					role="dialog"
					onClick={() => setFocusEditorOpen(false)}
				>
					<div
						className="flex w-full max-w-lg flex-col gap-2 rounded bg-[var(--map-tooltip-bg)] p-4 shadow-xl dark:bg-[var(--bg-primary)]"
						onClick={(e) => e.stopPropagation()}
					>
						<h3
							className="m-0 text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]"
							id="journal-focus-title"
						>
							{t('journalHeading')}
						</h3>
						<label className="flex flex-col gap-0.5 text-xs text-gray-600 dark:text-gray-400">
							{t('entryDateLabel')}
							<input
								className={cn(MAP_CONTROL_INPUT, 'w-full')}
								type="date"
								value={entryDate}
								onChange={(e) => setEntryDate(e.target.value)}
							/>
						</label>
						{/* autoFocus is intentional: opening a dedicated writing overlay IS the focus request. */}
						<textarea
							autoFocus
							aria-label={t('entryTextLabel')}
							className={cn(MAP_CONTROL_INPUT, 'min-h-[40dvh] w-full resize-y text-base')}
							placeholder={t('entryPlaceholder')}
							value={entryText}
							onChange={(e) => setEntryText(e.target.value)}
						/>
						{rulerKms && (
							<label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
								<Checkbox checked={attachRuler} onCheckedChange={(checked) => setAttachRuler(checked)} />
								{t('attachRuler', { range: `${fmt(rulerKms.lo)} - ${fmt(rulerKms.hi)}` })}
							</label>
						)}
						<div className="flex justify-end gap-2">
							<Button size="sm" variant="mapControlOutlineSecondary" onClick={() => setFocusEditorOpen(false)}>
								{t('focusEditorClose')}
							</Button>
							<Button
								disabled={entryText.trim().length === 0}
								size="sm"
								variant="base"
								onClick={() => {
									handleAddEntry();
									setFocusEditorOpen(false);
								}}
							>
								{t('addEntry')}
							</Button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
