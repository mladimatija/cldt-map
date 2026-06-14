'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { IoContractOutline, IoExpandOutline } from 'react-icons/io5';
import type { JournalEntry } from '@/lib/user-waypoints';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { MAP_CONTROL_INPUT } from './map-controls-constants';
import { MapControlModalShell } from './MapControlModalShell';
import { MapControlSectionCard } from './MapControlSectionCard';
import { JournalTrackAttachControls, type JournalAttachState } from './JournalTrackAttachControls';

interface JournalEntryEditorProps {
	entry: JournalEntry;
	rulerKms: { lo: number; hi: number } | null;
	onClose: () => void;
	onSave?: (patch: Partial<JournalEntry>) => void;
	readOnly?: boolean;
	onShowOnMap?: () => void;
	onExportGpx?: () => void;
	exportGpxDisabled?: boolean;
	exportGpxTitle?: string;
	showOnMapAvailable?: boolean;
}

export function JournalEntryEditor({
	entry,
	rulerKms,
	onSave,
	onClose,
	readOnly = false,
	onShowOnMap,
	onExportGpx,
	exportGpxDisabled = false,
	exportGpxTitle,
	showOnMapAvailable = false,
}: JournalEntryEditorProps): React.ReactElement {
	const t = useTranslations('progress');
	const importedTracks = useMapStore((s: MapStoreState) => s.importedTracks);
	const setJournalPreview = useMapStore((s: MapStoreState) => s.setJournalPreview);

	const [date, setDate] = useState(entry.date);
	const [text, setText] = useState(entry.text);
	const [attachRuler, setAttachRuler] = useState(
		entry.startKm !== undefined && entry.endKm !== undefined && !entry.trackLink,
	);
	const [attachState, setAttachState] = useState<JournalAttachState>({
		trackLink: entry.trackLink ?? null,
		startKm: entry.startKm,
		endKm: entry.endKm,
	});
	const [focusMode, setFocusMode] = useState(false);

	const pushPreview = useCallback(
		(state: JournalAttachState): void => {
			let trailStartKm = state.startKm;
			let trailEndKm = state.endKm;
			if (attachRuler && rulerKms && !state.trackLink) {
				trailStartKm = rulerKms.lo;
				trailEndKm = rulerKms.hi;
			}
			if (trailStartKm === undefined || trailEndKm === undefined) {
				setJournalPreview(null);
				return;
			}
			const track = state.trackLink ? importedTracks.find((tr) => tr.id === state.trackLink!.trackId) : null;
			setJournalPreview({
				entryId: entry.id,
				trailStartKm,
				trailEndKm,
				...(state.trackLink && track
					? {
							trackId: state.trackLink.trackId,
							startIdx: state.trackLink.startIdx,
							endIdx: state.trackLink.endIdx,
							trackColor: track.color,
						}
					: {}),
			});
		},
		[attachRuler, entry.id, importedTracks, rulerKms, setJournalPreview],
	);

	const handleClose = useCallback((): void => {
		setJournalPreview(null);
		onClose();
	}, [onClose, setJournalPreview]);

	useEffect(() => () => setJournalPreview(null), [setJournalPreview]);

	const buildPatch = (): Partial<JournalEntry> => {
		const trimmed = text.trim();
		if (!trimmed) return {};
		let startKm = attachState.startKm;
		let endKm = attachState.endKm;
		if (attachRuler && rulerKms && !attachState.trackLink) {
			startKm = rulerKms.lo;
			endKm = rulerKms.hi;
		}
		const patch: Partial<JournalEntry> = { date, text: trimmed };
		if (attachState.trackLink) {
			patch.trackLink = attachState.trackLink;
			if (startKm !== undefined && endKm !== undefined) {
				patch.startKm = startKm;
				patch.endKm = endKm;
			}
		} else if (startKm !== undefined && endKm !== undefined) {
			patch.startKm = startKm;
			patch.endKm = endKm;
			patch.trackLink = undefined;
		} else {
			patch.startKm = undefined;
			patch.endKm = undefined;
			patch.trackLink = undefined;
		}
		return patch;
	};

	const handleSave = (): void => {
		const patch = buildPatch();
		if (!patch.text || !onSave) return;
		onSave(patch);
		handleClose();
	};

	const titleId = readOnly ? 'journal-view-title' : 'journal-edit-title';
	const dialogLabel = readOnly ? t('journalView') : t('journalEdit');

	return (
		<MapControlModalShell
			open
			closeLabel={t('journalClose')}
			title={dialogLabel}
			titleId={titleId}
			onClose={handleClose}
		>
			<MapControlSectionCard title={t('journalSectionDate')}>
				<label className="flex flex-col gap-0.5 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
					{t('entryDateLabel')}
					<input
						aria-readonly={readOnly || undefined}
						className={cn(MAP_CONTROL_INPUT, 'w-full', readOnly && 'cursor-default opacity-100')}
						readOnly={readOnly}
						type="date"
						value={date}
						onChange={readOnly ? undefined : (e) => setDate(e.target.value)}
					/>
				</label>
			</MapControlSectionCard>

			<MapControlSectionCard title={t('journalSectionText')}>
				<div className="relative">
					<textarea
						aria-label={t('entryTextLabel')}
						aria-readonly={readOnly || undefined}
						autoFocus={!readOnly && focusMode}
						className={cn(
							MAP_CONTROL_INPUT,
							readOnly && 'cursor-default resize-none',
							focusMode ? 'min-h-[40dvh] w-full resize-y text-base' : 'w-full resize-y pr-8',
						)}
						placeholder={readOnly ? undefined : t('entryPlaceholder')}
						readOnly={readOnly}
						rows={focusMode ? 12 : 6}
						value={text}
						onChange={readOnly ? undefined : (e) => setText(e.target.value)}
					/>
					{!readOnly && !focusMode && (
						<button
							aria-label={t('focusEditor')}
							className="hover:text-cldt-blue focus-visible:ring-cldt-green absolute top-1 right-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-gray-500 outline-none focus-visible:ring-2 dark:text-[var(--text-secondary)]"
							title={t('focusEditor')}
							type="button"
							onClick={() => setFocusMode(true)}
						>
							<IoExpandOutline aria-hidden className="h-4.5 w-4.5" />
						</button>
					)}
					{focusMode && (
						<button
							aria-label={t('focusEditorClose')}
							className="hover:text-cldt-blue focus-visible:ring-cldt-green absolute top-1 right-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-gray-500 outline-none focus-visible:ring-2 dark:text-[var(--text-secondary)]"
							title={t('focusEditorClose')}
							type="button"
							onClick={() => setFocusMode(false)}
						>
							<IoContractOutline aria-hidden className="h-4.5 w-4.5" />
						</button>
					)}
				</div>
			</MapControlSectionCard>

			<MapControlSectionCard title={t('journalSectionTrack')}>
				<JournalTrackAttachControls
					attachRuler={attachRuler}
					readOnly={readOnly}
					rulerKms={rulerKms}
					value={attachState}
					onAttachRulerChange={(checked) => {
						setAttachRuler(checked);
						if (!checked && !attachState.trackLink) {
							const next = { trackLink: null };
							setAttachState(next);
							pushPreview(next);
						} else if (checked && rulerKms && !attachState.trackLink) {
							const next = { ...attachState, startKm: rulerKms.lo, endKm: rulerKms.hi };
							setAttachState(next);
							pushPreview(next);
						}
					}}
					onChange={setAttachState}
					onPreview={pushPreview}
				/>
			</MapControlSectionCard>

			<div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-2 dark:border-[var(--border-color)]">
				{readOnly ? (
					<>
						{showOnMapAvailable && onShowOnMap && (
							<Button size="sm" variant="mapControlOutline" onClick={onShowOnMap}>
								{t('journalShowOnMap')}
							</Button>
						)}
						{onExportGpx && (
							<Button
								disabled={exportGpxDisabled}
								size="sm"
								title={exportGpxTitle ?? t('journalExportGpx')}
								variant="mapControlOutline"
								onClick={onExportGpx}
							>
								{t('journalExportGpx')}
							</Button>
						)}
						<Button size="sm" variant="mapControlOutlineSecondary" onClick={handleClose}>
							{t('journalClose')}
						</Button>
					</>
				) : (
					<>
						<Button size="sm" variant="mapControlOutlineSecondary" onClick={handleClose}>
							{t('journalCancel')}
						</Button>
						<Button disabled={text.trim().length === 0} size="sm" variant="mapControlOutline" onClick={handleSave}>
							{t('journalSave')}
						</Button>
					</>
				)}
			</div>
		</MapControlModalShell>
	);
}
