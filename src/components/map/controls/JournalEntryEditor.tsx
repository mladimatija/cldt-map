'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
	IoCheckmarkOutline,
	IoCloseOutline,
	IoContractOutline,
	IoDownloadOutline,
	IoExpandOutline,
	IoMapOutline,
} from 'react-icons/io5';
import type { JournalEntry } from '@/lib/user-waypoints';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { MAP_CONTROL_INPUT } from './map-controls-constants';
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
		onClose();
	};

	const titleId = readOnly ? 'journal-view-title' : 'journal-edit-title';
	const dialogLabel = readOnly ? t('journalView') : t('journalEdit');
	const hasFooterActions = readOnly ? (showOnMapAvailable && !!onShowOnMap) || !!onExportGpx || focusMode : true;

	const editorBody = (
		<>
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
				{!focusMode && (
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
			</div>
			<JournalTrackAttachControls
				attachRuler={attachRuler}
				readOnly={readOnly}
				rulerKms={rulerKms}
				value={attachState}
				onAttachRulerChange={(checked) => {
					setAttachRuler(checked);
					if (!checked && !attachState.trackLink) {
						setAttachState({ trackLink: null });
					} else if (checked && rulerKms && !attachState.trackLink) {
						setAttachState({ ...attachState, startKm: rulerKms.lo, endKm: rulerKms.hi });
					}
				}}
				onChange={setAttachState}
				onPreview={() => {}}
			/>
		</>
	);

	return (
		<div
			aria-labelledby={titleId}
			aria-modal="true"
			className="z-modal fixed inset-0 flex items-center justify-center bg-[var(--modal-backdrop-bg)] p-4"
			role="dialog"
			onClick={onClose}
		>
			<div
				className="relative flex max-h-[90dvh] w-full max-w-lg flex-col gap-2 overflow-y-auto rounded bg-[var(--map-tooltip-bg)] p-4 shadow-xl dark:bg-[var(--bg-primary)]"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="relative shrink-0">
					<Button
						aria-label={t('journalClose')}
						className="absolute top-0 right-0"
						title={t('journalClose')}
						variant="closeIcon"
						onClick={onClose}
					>
						<IoCloseOutline aria-hidden className="h-4 w-4" />
					</Button>
					<h3 className="m-0 pr-7 text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]" id={titleId}>
						{dialogLabel}
					</h3>
				</div>
				{editorBody}
				{hasFooterActions && (
					<div className="flex flex-wrap justify-end gap-2">
						{readOnly ? (
							<>
								{showOnMapAvailable && onShowOnMap && (
									<Button
										aria-label={t('journalShowOnMap')}
										className="h-8 w-8 shrink-0 px-0"
										size="sm"
										title={t('journalShowOnMap')}
										variant="base"
										onClick={onShowOnMap}
									>
										<IoMapOutline aria-hidden className="h-3.5 w-3.5" />
									</Button>
								)}
								{onExportGpx && (
									<Button
										aria-label={t('journalExportGpx')}
										className="h-8 w-8 shrink-0 px-0"
										disabled={exportGpxDisabled}
										size="sm"
										title={exportGpxTitle ?? t('journalExportGpx')}
										variant="base"
										onClick={onExportGpx}
									>
										<IoDownloadOutline aria-hidden className="h-3.5 w-3.5" />
									</Button>
								)}
								{focusMode && (
									<Button
										aria-label={t('focusEditorClose')}
										className="h-8 w-8 shrink-0 px-0"
										size="sm"
										title={t('focusEditorClose')}
										variant="mapControlOutlineSecondary"
										onClick={() => setFocusMode(false)}
									>
										<IoContractOutline aria-hidden className="h-3.5 w-3.5" />
									</Button>
								)}
							</>
						) : (
							<>
								{focusMode && (
									<Button
										aria-label={t('focusEditorClose')}
										className="h-8 w-8 shrink-0 px-0"
										size="sm"
										title={t('focusEditorClose')}
										variant="mapControlOutlineSecondary"
										onClick={() => setFocusMode(false)}
									>
										<IoContractOutline aria-hidden className="h-3.5 w-3.5" />
									</Button>
								)}
								<Button
									aria-label={t('journalSave')}
									className="h-8 w-8 shrink-0 px-0"
									disabled={text.trim().length === 0}
									size="sm"
									title={t('journalSave')}
									variant="base"
									onClick={handleSave}
								>
									<IoCheckmarkOutline aria-hidden className="h-3.5 w-3.5" />
								</Button>
							</>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
