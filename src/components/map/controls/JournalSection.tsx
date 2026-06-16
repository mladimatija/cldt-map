'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import {
	IoAddOutline,
	IoArchiveOutline,
	IoCloudUploadOutline,
	IoDocumentTextOutline,
	IoEyeOutline,
	IoMapOutline,
	IoTodayOutline,
} from 'react-icons/io5';
import { useTranslations } from 'next-intl';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { exportJournalBundle, exportJournalEntryGpx } from '@/lib/journal-gpx-export';
import {
	buildJournalPreview,
	displayTrailKm,
	journalEntryBoundsForFit,
	resolveTrackLink,
} from '@/lib/journal-track-link';
import { downloadTextFile, journalToMarkdown, newId, todayIsoDate, type JournalEntry } from '@/lib/user-waypoints';
import { parseJournalMarkdown, parsedJournalToEntries } from '@/lib/user-waypoint-import';
import { findNearestPointIndex } from '@/lib/distance-utils';
import { TRAIL_OFF_TRAIL_THRESHOLD_M } from '@/lib/config';
import { cn, formatDistance, formatElevation } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { MAP_CONTROL_INPUT } from './map-controls-constants';
import { MapControlIconButton } from './MapControlIconButton';
import { MapControlModalShell } from './MapControlModalShell';
import { MapControlSectionCard } from './MapControlSectionCard';
import { JournalEntryEditor } from './JournalEntryEditor';
import { JournalEntryOverflowMenu } from './JournalEntryOverflowMenu';
import { JournalTrackAttachControls, type JournalAttachState } from './JournalTrackAttachControls';

interface JournalSectionProps {
	embedded?: boolean;
}

export function JournalSection({ embedded = false }: JournalSectionProps): React.ReactElement {
	const t = useTranslations('progress');
	const tTrail = useTranslations('trailRoute');
	const map = useMap();

	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);
	const direction = useMapStore((s: MapStoreState) => s.direction);
	const rulerRange = useMapStore((s: MapStoreState) => s.rulerRange);
	const journalEntries = useMapStore((s: MapStoreState) => s.journalEntries);
	const addJournalEntry = useMapStore((s: MapStoreState) => s.addJournalEntry);
	const updateJournalEntry = useMapStore((s: MapStoreState) => s.updateJournalEntry);
	const removeJournalEntry = useMapStore((s: MapStoreState) => s.removeJournalEntry);
	const importedTracks = useMapStore((s: MapStoreState) => s.importedTracks);
	const setJournalPreview = useMapStore((s: MapStoreState) => s.setJournalPreview);
	const journalHighlightEntryId = useMapStore((s: MapStoreState) => s.journalHighlightEntryId);
	const setJournalHighlightEntryId = useMapStore((s: MapStoreState) => s.setJournalHighlightEntryId);

	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);
	const closestPoint = useStore((s: StoreState) => s.closestPoint);
	const totalKm = useStore((s: StoreState) => s.trailMetadata.totalDistance);

	// A non-null closestPoint only means "some GPS fix exists" - it is set even
	// kilometres off-route. "Log today" snapshots the current trail km/section,
	// so gate it on the shared on-trail derivation (matches useTrailSunWeather /
	// the daylight chip) rather than bare truthiness.
	const isOnTrail = !!closestPoint && closestPoint.distance <= TRAIL_OFF_TRAIL_THRESHOLD_M;

	const [entryDate, setEntryDate] = useState(todayIsoDate);
	const [entryText, setEntryText] = useState('');
	const [attachRuler, setAttachRuler] = useState(false);
	const [attachState, setAttachState] = useState<JournalAttachState>({ trackLink: null });
	const [composeOpen, setComposeOpen] = useState(false);
	const [journalImportError, setJournalImportError] = useState<string | null>(null);
	const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
	const [viewingEntry, setViewingEntry] = useState<JournalEntry | null>(null);
	const journalImportInputRef = useRef<HTMLInputElement>(null);

	useEffect(
		() => () => {
			setJournalPreview(null);
			setJournalHighlightEntryId(null);
		},
		[setJournalPreview, setJournalHighlightEntryId],
	);

	const rulerKms = useMemo((): { lo: number; hi: number } | null => {
		if (!rulerRange) return null;
		const a = rulerRange.distanceFromStartA / 1000;
		const b = rulerRange.distanceFromStartB / 1000;
		return { lo: Math.min(a, b), hi: Math.max(a, b) };
	}, [rulerRange]);

	const fmt = (km: number): string => formatDistance(km, units, distancePrecision);
	const fmtDisplayKm = (soboKm: number): string => fmt(displayTrailKm(soboKm, direction, totalKm));

	const journalSorted = useMemo(
		() => [...journalEntries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
		[journalEntries],
	);
	// Only offer the bundle when at least one entry links to a track that is
	// actually on this device. A missing track has no geometry to export, so
	// the zip would contain only the Markdown the plain Export already provides.
	const hasExportableTrackEntry = useMemo(
		() => journalEntries.some((entry) => resolveTrackLink(entry, importedTracks).status === 'ok'),
		[journalEntries, importedTracks],
	);
	const showExportBundle = hasExportableTrackEntry;

	const resetCompose = (): void => {
		setEntryDate(todayIsoDate());
		setEntryText('');
		setAttachRuler(false);
		setAttachState({ trackLink: null });
		setJournalPreview(null);
	};

	const pushPreview = (state: JournalAttachState, entryId: string | null): void => {
		setJournalPreview(buildJournalPreview(state, attachRuler, rulerKms, importedTracks, entryId));
	};

	const handleAttachChange = (next: JournalAttachState): void => {
		setAttachState(next);
		pushPreview(next, null);
	};

	const handleAttachRulerChange = (checked: boolean): void => {
		setAttachRuler(checked);
		if (checked && rulerKms && !attachState.trackLink) {
			const next = { ...attachState, startKm: rulerKms.lo, endKm: rulerKms.hi };
			setAttachState(next);
			pushPreview(next, null);
		} else if (!checked && !attachState.trackLink) {
			const next: JournalAttachState = { trackLink: null };
			setAttachState(next);
			setJournalPreview(null);
		}
	};

	const handleAddEntry = (): void => {
		const text = entryText.trim();
		if (!text) return;
		let startKm = attachState.startKm;
		let endKm = attachState.endKm;
		if (attachRuler && rulerKms && !attachState.trackLink) {
			startKm = rulerKms.lo;
			endKm = rulerKms.hi;
		}
		const entry: JournalEntry = {
			id: newId(),
			date: entryDate || todayIsoDate(),
			text,
			createdAt: new Date().toISOString(),
			...(startKm !== undefined && endKm !== undefined ? { startKm, endKm } : {}),
			...(attachState.trackLink ? { trackLink: attachState.trackLink } : {}),
		};
		addJournalEntry(entry);
		resetCompose();
		setComposeOpen(false);
	};

	const handleExportJournal = (): void => {
		if (journalEntries.length === 0) return;
		const md = journalToMarkdown(
			journalEntries,
			{
				title: t('journalHeading'),
				rangeLine: (range) => t('journalRangeLine', { range }),
				trackLine: (name) => t('journalTrackLine', { name }),
			},
			(km, u) => formatDistance(km, u, distancePrecision),
			units,
		);
		downloadTextFile(md, 'cldt-journal.md');
	};

	const handleExportBundle = (): void => {
		if (journalEntries.length === 0) return;
		void exportJournalBundle(
			journalEntries,
			importedTracks,
			{
				title: t('journalHeading'),
				rangeLine: (range) => t('journalRangeLine', { range }),
				trackLine: (name) => t('journalTrackLine', { name }),
			},
			(km, u) => formatDistance(km, u, distancePrecision),
			units,
		);
	};

	const mapJournalImportError = (code: string): string => {
		switch (code) {
			case 'FILE_TOO_LARGE':
				return t('importJournalTooLarge');
			case 'NO_ENTRIES':
				return t('importJournalError');
			default:
				return t('importJournalError');
		}
	};

	const handleImportJournalFile = async (file: File): Promise<void> => {
		setJournalImportError(null);
		try {
			const parsed = parseJournalMarkdown(await file.text());
			for (const entry of parsedJournalToEntries(parsed, newId)) {
				addJournalEntry(entry);
			}
		} catch (err) {
			const code = err instanceof Error ? err.message : '';
			setJournalImportError(mapJournalImportError(code));
		}
	};

	const showEntryOnMap = (entry: JournalEntry): void => {
		const resolved = resolveTrackLink(entry, importedTracks);
		const track = resolved.status === 'ok' ? resolved.track : null;
		const bounds = journalEntryBoundsForFit(entry, track, enhancedTrailPoints);
		if (bounds) map.fitBounds(L.latLngBounds(bounds[0], bounds[1]), { padding: [20, 20] });
		if (entry.trackLink && track) {
			setJournalPreview({
				entryId: entry.id,
				trailStartKm: entry.startKm ?? 0,
				trailEndKm: entry.endKm ?? 0,
				trackId: entry.trackLink.trackId,
				startIdx: entry.trackLink.startIdx,
				endIdx: entry.trackLink.endIdx,
				trackColor: track.color,
			});
		} else if (entry.startKm !== undefined && entry.endKm !== undefined) {
			setJournalPreview({
				entryId: entry.id,
				trailStartKm: entry.startKm,
				trailEndKm: entry.endKm,
			});
		}
		setJournalHighlightEntryId(entry.id);
	};

	const handleExportEntryGpx = (entry: JournalEntry): void => {
		const resolved = resolveTrackLink(entry, importedTracks);
		if (resolved.status !== 'ok') return;
		exportJournalEntryGpx(entry, resolved.track);
	};

	const openCompose = (): void => {
		resetCompose();
		setComposeOpen(true);
	};

	// One-tap end-of-day capture: open the composer prefilled with today's date
	// (resetCompose default) and a current-position snapshot - trail km,
	// elevation, and section - so a nightly entry is a single tap instead of a
	// multi-field form. Shown only when an on-trail GPS fix is available.
	const openLogToday = (): void => {
		resetCompose();
		if (isOnTrail && closestPoint) {
			const ep =
				enhancedTrailPoints.length > 0
					? enhancedTrailPoints[findNearestPointIndex(enhancedTrailPoints, closestPoint.distanceFromStart)]
					: undefined;
			const parts = [fmtDisplayKm(closestPoint.distanceFromStart / 1000)];
			if (ep && Number.isFinite(ep.elevation)) parts.push(formatElevation(ep.elevation, units));
			if (ep?.sectionName) parts.push(tTrail(ep.sectionName));
			setEntryText(`${parts.join(' · ')}\n`);
		}
		setComposeOpen(true);
	};

	const closeCompose = (): void => {
		setComposeOpen(false);
		setJournalPreview(null);
	};

	const composeModal =
		composeOpen &&
		typeof document !== 'undefined' &&
		createPortal(
			<MapControlModalShell
				closeLabel={t('journalClose')}
				open={composeOpen}
				title={t('addEntry')}
				titleId="journal-compose-title"
				onClose={closeCompose}
			>
				<MapControlSectionCard title={t('journalSectionDate')}>
					<label className="flex flex-col gap-0.5 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
						{t('entryDateLabel')}
						<input
							className={cn(MAP_CONTROL_INPUT, 'w-full')}
							type="date"
							value={entryDate}
							onChange={(ev) => setEntryDate(ev.target.value)}
						/>
					</label>
				</MapControlSectionCard>
				<MapControlSectionCard title={t('journalSectionText')}>
					<textarea
						autoFocus
						aria-label={t('entryTextLabel')}
						className={cn(MAP_CONTROL_INPUT, 'min-h-[30dvh] w-full resize-y text-base')}
						placeholder={t('entryPlaceholder')}
						value={entryText}
						onChange={(ev) => setEntryText(ev.target.value)}
					/>
				</MapControlSectionCard>
				<MapControlSectionCard title={t('journalSectionTrack')}>
					<JournalTrackAttachControls
						attachRuler={attachRuler}
						rulerKms={rulerKms}
						value={attachState}
						onAttachRulerChange={handleAttachRulerChange}
						onChange={handleAttachChange}
						onPreview={(next) => pushPreview(next, null)}
					/>
				</MapControlSectionCard>
				<div className="flex justify-end gap-2 border-t border-gray-100 pt-2 dark:border-[var(--border-color)]">
					<Button size="sm" variant="mapControlOutlineSecondary" onClick={closeCompose}>
						{t('journalCancel')}
					</Button>
					<Button
						disabled={entryText.trim().length === 0}
						size="sm"
						variant="mapControlOutline"
						onClick={handleAddEntry}
					>
						{t('addEntry')}
					</Button>
				</div>
			</MapControlModalShell>,
			document.body,
		);

	return (
		<>
			<div className="flex flex-col gap-2">
				{!embedded ? (
					<p className="m-0 text-xs font-semibold tracking-wide text-gray-600 uppercase dark:text-[var(--text-secondary)]">
						{t('journalHeading')}
					</p>
				) : null}

				<div className="flex flex-wrap items-center gap-1.5">
					<MapControlIconButton aria-label={t('addEntry')} variant="mapControlOutline" onClick={openCompose}>
						<IoAddOutline aria-hidden className="h-3.5 w-3.5" />
					</MapControlIconButton>
					{isOnTrail && (
						<Button size="sm" variant="mapControlOutline" onClick={openLogToday}>
							<IoTodayOutline aria-hidden className="mr-1 h-3.5 w-3.5" />
							{t('logToday')}
						</Button>
					)}
				</div>

				{journalSorted.length === 0 ? (
					<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('noEntries')}</p>
				) : (
					journalSorted.map((e) => {
						const resolved = resolveTrackLink(e, importedTracks);
						const isHighlighted = journalHighlightEntryId === e.id;
						const showOnMap = e.startKm !== undefined || !!e.trackLink;
						return (
							<div
								aria-current={isHighlighted ? 'true' : undefined}
								className={cn(
									'flex min-w-0 items-start gap-2 rounded-md p-1.5 transition-colors',
									isHighlighted &&
										'border-cldt-blue/30 bg-cldt-blue/5 ring-cldt-blue/40 dark:border-cldt-blue/40 dark:bg-cldt-blue/15 dark:ring-cldt-blue/50 border ring-1',
								)}
								key={e.id}
							>
								<div className="min-w-0 flex-1">
									<p className="m-0 text-xs font-medium text-gray-700 dark:text-[var(--text-primary)]">
										{e.date}
										{e.startKm !== undefined && e.endKm !== undefined && (
											<span className="font-normal text-gray-400 dark:text-[var(--text-secondary)]">
												{' '}
												· {fmtDisplayKm(e.startKm)} - {fmtDisplayKm(e.endKm)}
											</span>
										)}
									</p>
									{e.trackLink && (
										<p className="m-0 flex min-w-0 items-center gap-2 text-xs text-gray-600 dark:text-[var(--text-primary)]">
											{resolved.status === 'ok' ? (
												<>
													<span
														aria-hidden
														className="h-2 w-2 shrink-0 rounded-full"
														style={{ background: resolved.track.color }}
													/>
													<span className="min-w-0 truncate">{resolved.link.trackName || resolved.track.name}</span>
												</>
											) : (
												<>
													<span aria-hidden className="bg-cldt-red h-2 w-2 shrink-0 rounded-full" />
													<span className="min-w-0 truncate">
														{t('journalTrackMissing', { name: e.trackLink.trackName || e.trackLink.trackId })}
													</span>
												</>
											)}
										</p>
									)}
									<p className="m-0 line-clamp-2 text-xs break-words whitespace-pre-line text-gray-600 dark:text-[var(--text-primary)]">
										{e.text}
									</p>
									<div className="mt-1 flex flex-wrap items-center gap-1">
										<MapControlIconButton
											aria-label={t('journalViewEntry', { date: e.date })}
											title={t('journalView')}
											onClick={() => setViewingEntry(e)}
										>
											<IoEyeOutline aria-hidden className="h-3.5 w-3.5" />
										</MapControlIconButton>
										{showOnMap ? (
											<MapControlIconButton aria-label={t('journalShowOnMap')} onClick={() => showEntryOnMap(e)}>
												<IoMapOutline aria-hidden className="h-3.5 w-3.5" />
											</MapControlIconButton>
										) : null}
									</div>
								</div>
								<JournalEntryOverflowMenu
									deleteLabel={t('waypointDelete')}
									editLabel={t('journalEdit')}
									exportGpxDisabled={resolved.status !== 'ok'}
									exportGpxLabel={t('journalExportGpx')}
									exportGpxTitle={resolved.status !== 'ok' ? t('journalExportGpxMissing') : undefined}
									menuLabel={t('journalMoreActions')}
									showExportGpx={!!e.trackLink}
									onDelete={() => removeJournalEntry(e.id)}
									onEdit={() => setEditingEntry(e)}
									onExportGpx={e.trackLink ? () => handleExportEntryGpx(e) : undefined}
								/>
							</div>
						);
					})
				)}

				<div className="flex flex-row flex-wrap items-center gap-1.5 border-t border-gray-200 pt-2 dark:border-[var(--border-color)]">
					<MapControlIconButton
						aria-label={t('importJournal')}
						variant="mapControlOutlineSecondary"
						onClick={() => journalImportInputRef.current?.click()}
					>
						<IoCloudUploadOutline aria-hidden className="h-3.5 w-3.5" />
					</MapControlIconButton>
					{journalEntries.length > 0 && (
						<MapControlIconButton
							aria-label={t('exportJournal')}
							variant="mapControlOutlineSecondary"
							onClick={handleExportJournal}
						>
							<IoDocumentTextOutline aria-hidden className="h-3.5 w-3.5" />
						</MapControlIconButton>
					)}
					{showExportBundle && (
						<MapControlIconButton
							aria-label={t('journalExportBundle')}
							variant="mapControlOutlineSecondary"
							onClick={handleExportBundle}
						>
							<IoArchiveOutline aria-hidden className="h-3.5 w-3.5" />
						</MapControlIconButton>
					)}
				</div>

				<input
					accept=".md,text/markdown"
					className="hidden"
					ref={journalImportInputRef}
					type="file"
					onChange={(e) => {
						const file = e.target.files?.[0];
						if (file) void handleImportJournalFile(file);
						e.target.value = '';
					}}
				/>
				{journalImportError && <p className="text-cldt-red m-0 text-xs">{journalImportError}</p>}
			</div>

			{composeModal}

			{editingEntry && (
				<JournalEntryEditor
					entry={editingEntry}
					key={editingEntry.id}
					rulerKms={rulerKms}
					onClose={() => setEditingEntry(null)}
					onSave={(patch) => {
						updateJournalEntry(editingEntry.id, patch);
						setEditingEntry(null);
					}}
				/>
			)}

			{viewingEntry &&
				(() => {
					const resolved = resolveTrackLink(viewingEntry, importedTracks);
					return (
						<JournalEntryEditor
							readOnly
							entry={viewingEntry}
							exportGpxDisabled={resolved.status !== 'ok'}
							exportGpxTitle={resolved.status !== 'ok' ? t('journalExportGpxMissing') : undefined}
							key={viewingEntry.id}
							rulerKms={rulerKms}
							showOnMapAvailable={viewingEntry.startKm !== undefined || !!viewingEntry.trackLink}
							onClose={() => setViewingEntry(null)}
							onExportGpx={viewingEntry.trackLink ? () => handleExportEntryGpx(viewingEntry) : undefined}
							onShowOnMap={() => showEntryOnMap(viewingEntry)}
						/>
					);
				})()}
		</>
	);
}
