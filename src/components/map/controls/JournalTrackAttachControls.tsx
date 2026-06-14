'use client';

import React, { useRef, useState } from 'react';
import { IoArchiveOutline, IoCloudUploadOutline, IoLinkOutline, IoUnlinkOutline } from 'react-icons/io5';
import { useTranslations } from 'next-intl';
import { importGpxFileAsTrack } from '@/lib/imported-tracks';
import {
	buildJournalTrackAttachment,
	computeIndicesForTrailRange,
	displayTrailKm,
	formatRecordedStats,
	sliceTrackPoints,
	validateTrackLink,
} from '@/lib/journal-track-link';
import { buildSpatialGrid } from '@/lib/spatial-grid';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import type { ImportedTrack } from '@/lib/store/types';
import type { JournalTrackLink } from '@/lib/user-waypoints';
import { cn, formatDistance } from '@/lib/utils';
import { Checkbox } from '@/components/ui/Checkbox';
import { MapControlIconButton } from './MapControlIconButton';

export interface JournalAttachState {
	trackLink: JournalTrackLink | null;
	startKm?: number;
	endKm?: number;
}

interface JournalTrackAttachControlsProps {
	value: JournalAttachState;
	onChange: (next: JournalAttachState) => void;
	rulerKms: { lo: number; hi: number } | null;
	attachRuler: boolean;
	onAttachRulerChange: (checked: boolean) => void;
	onPreview: (preview: JournalAttachState) => void;
	onExportBundle?: () => void;
	showExportBundle?: boolean;
	readOnly?: boolean;
}

export function JournalTrackAttachControls({
	value,
	onChange,
	rulerKms,
	attachRuler,
	onAttachRulerChange,
	onPreview,
	onExportBundle,
	showExportBundle = false,
	readOnly = false,
}: JournalTrackAttachControlsProps): React.ReactNode {
	const t = useTranslations('progress');
	const importedTracks = useMapStore((s: MapStoreState) => s.importedTracks);
	const addImportedTrack = useMapStore((s: MapStoreState) => s.addImportedTrack);
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);
	const direction = useMapStore((s: MapStoreState) => s.direction);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);
	const totalKm = useStore((s: StoreState) => s.trailMetadata.totalDistance);

	const [error, setError] = useState<string | null>(null);
	const [useRulerOnTrack, setUseRulerOnTrack] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const fmt = (km: number): string => formatDistance(km, units, distancePrecision);
	const fmtDisplayKm = (soboKm: number): string => fmt(displayTrailKm(soboKm, direction, totalKm));

	const applyTrack = (track: ImportedTrack, startIdx: number, endIdx: number): void => {
		const grid = enhancedTrailPoints.length > 0 ? buildSpatialGrid(enhancedTrailPoints) : undefined;
		const built = buildJournalTrackAttachment(track, startIdx, endIdx, enhancedTrailPoints, grid);
		setError(null);
		const next: JournalAttachState = {
			trackLink: built.trackLink,
			...(built.startKm !== undefined && built.endKm !== undefined
				? { startKm: built.startKm, endKm: built.endKm }
				: {}),
		};
		onChange(next);
		onPreview(next);
	};

	const handleImportGpx = async (file: File): Promise<void> => {
		setError(null);
		try {
			const currentTracks = useMapStore.getState().importedTracks;
			const result = await importGpxFileAsTrack(file, currentTracks);
			if (result.status !== 'ok') {
				setError(t('importWaypointsError'));
				return;
			}
			const { track } = result;
			if (result.isNew) {
				addImportedTrack(track);
			}
			let startIdx = 0;
			let endIdx = track.points.length - 1;
			if (useRulerOnTrack && rulerKms) {
				const grid = enhancedTrailPoints.length > 0 ? buildSpatialGrid(enhancedTrailPoints) : undefined;
				const indices = computeIndicesForTrailRange(track, rulerKms.lo, rulerKms.hi, enhancedTrailPoints, grid);
				if (!indices) {
					setError(t('journalAttachEmptyIntersect'));
					return;
				}
				startIdx = indices.startIdx;
				endIdx = indices.endIdx;
			}
			applyTrack(track, startIdx, endIdx);
		} catch {
			setError(t('importWaypointsError'));
		}
	};

	const handlePickTrack = (trackId: string): void => {
		const track = importedTracks.find((tr) => tr.id === trackId);
		if (!track || track.points.length === 0) return;
		let startIdx = 0;
		let endIdx = track.points.length - 1;
		if (useRulerOnTrack && rulerKms) {
			const grid = enhancedTrailPoints.length > 0 ? buildSpatialGrid(enhancedTrailPoints) : undefined;
			const indices = computeIndicesForTrailRange(track, rulerKms.lo, rulerKms.hi, enhancedTrailPoints, grid);
			if (!indices) {
				setError(t('journalAttachEmptyIntersect'));
				return;
			}
			startIdx = indices.startIdx;
			endIdx = indices.endIdx;
		}
		applyTrack(track, startIdx, endIdx);
	};

	const handleRemoveLink = (): void => {
		setError(null);
		const next: JournalAttachState =
			attachRuler && rulerKms ? { trackLink: null, startKm: rulerKms.lo, endKm: rulerKms.hi } : { trackLink: null };
		onChange(next);
		onPreview(next);
	};

	const linkedTrack = value.trackLink ? importedTracks.find((tr) => tr.id === value.trackLink?.trackId) : null;
	const linkedTrackName = value.trackLink
		? value.trackLink.trackName || linkedTrack?.name || value.trackLink.trackId
		: '';
	const recordedLabel =
		value.trackLink && linkedTrack
			? (() => {
					const stats = formatRecordedStats(
						sliceTrackPoints(linkedTrack, validateTrackLink(value.trackLink, linkedTrack)),
					);
					return stats.distanceM > 0 ? formatDistance(stats.distanceM / 1000, units, distancePrecision) : null;
				})()
			: null;
	const stretchRange =
		value.startKm !== undefined && value.endKm !== undefined
			? `${fmtDisplayKm(value.startKm)} - ${fmtDisplayKm(value.endKm)}`
			: null;

	if (readOnly) {
		if (!value.trackLink && value.startKm === undefined) return null;
		return (
			<div className="flex flex-col gap-1">
				{value.trackLink && (
					<div className="flex min-w-0 items-center gap-2 text-xs">
						{linkedTrack ? (
							<span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: linkedTrack.color }} />
						) : (
							<span
								aria-hidden
								className="bg-cldt-red h-2 w-2 shrink-0 rounded-full"
								title={t('journalTrackMissing', { name: linkedTrackName })}
							/>
						)}
						<span
							className="min-w-0 flex-1 truncate text-gray-600 dark:text-[var(--text-primary)]"
							title={linkedTrackName}
						>
							{linkedTrack ? linkedTrackName : t('journalTrackMissing', { name: linkedTrackName })}
						</span>
					</div>
				)}
				{!linkedTrack && value.trackLink && (
					<p className="m-0 pl-4 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
						{t('journalTrackMissingHint')}
					</p>
				)}
				{(recordedLabel || stretchRange) && (
					<div
						className={cn(
							'flex flex-col gap-0.5 text-xs text-gray-500 dark:text-[var(--text-secondary)]',
							value.trackLink && 'pl-4',
						)}
					>
						{recordedLabel && <p className="m-0">{t('journalRecordedLine', { distance: recordedLabel })}</p>}
						{stretchRange && <p className="m-0">{t('journalTrailLine', { range: stretchRange })}</p>}
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1.5">
			{value.trackLink ? (
				<div className="flex flex-col gap-1">
					<div className="flex min-w-0 items-center gap-2 text-xs">
						{linkedTrack ? (
							<span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: linkedTrack.color }} />
						) : (
							<span
								aria-hidden
								className="bg-cldt-red h-2 w-2 shrink-0 rounded-full"
								title={t('journalTrackMissing', { name: linkedTrackName })}
							/>
						)}
						<span
							className="min-w-0 flex-1 truncate text-gray-600 dark:text-[var(--text-primary)]"
							title={linkedTrackName}
						>
							{linkedTrack ? linkedTrackName : t('journalTrackMissing', { name: linkedTrackName })}
						</span>
						<MapControlIconButton aria-label={t('journalRemoveTrackLink')} onClick={handleRemoveLink}>
							<IoUnlinkOutline aria-hidden className="h-3.5 w-3.5" />
						</MapControlIconButton>
					</div>
					{!linkedTrack && (
						<p className="m-0 pl-4 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
							{t('journalTrackMissingHint')}
						</p>
					)}
					{(recordedLabel || stretchRange) && (
						<div className="flex flex-col gap-0.5 pl-4 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
							{recordedLabel && <p className="m-0">{t('journalRecordedLine', { distance: recordedLabel })}</p>}
							{stretchRange && <p className="m-0">{t('journalTrailLine', { range: stretchRange })}</p>}
						</div>
					)}
					{showExportBundle && onExportBundle && (
						<div className="flex flex-row flex-wrap items-center gap-1.5 pl-4">
							<MapControlIconButton
								aria-label={t('journalExportBundle')}
								variant="mapControlOutlineSecondary"
								onClick={onExportBundle}
							>
								<IoArchiveOutline aria-hidden className="h-3.5 w-3.5" />
							</MapControlIconButton>
						</div>
					)}
				</div>
			) : (
				<>
					{importedTracks.length === 0 ? (
						<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
							{t('journalNoTracksImported')}
						</p>
					) : (
						<div className="flex max-h-24 flex-col gap-1 overflow-y-auto">
							{importedTracks.map((track) => (
								<div className="flex min-w-0 items-center gap-2 text-xs" key={track.id}>
									<span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: track.color }} />
									<span
										className="min-w-0 flex-1 truncate text-gray-600 dark:text-[var(--text-primary)]"
										title={track.name}
									>
										{track.name}
									</span>
									<MapControlIconButton aria-label={t('journalAttachTrack')} onClick={() => handlePickTrack(track.id)}>
										<IoLinkOutline aria-hidden className="h-3.5 w-3.5" />
									</MapControlIconButton>
								</div>
							))}
						</div>
					)}
					<div className="flex flex-row flex-wrap items-center gap-1.5">
						<MapControlIconButton
							aria-label={t('journalImportGpx')}
							variant="mapControlOutlineSecondary"
							onClick={() => fileInputRef.current?.click()}
						>
							<IoCloudUploadOutline aria-hidden className="h-3.5 w-3.5" />
						</MapControlIconButton>
						{showExportBundle && onExportBundle && (
							<MapControlIconButton
								aria-label={t('journalExportBundle')}
								variant="mapControlOutlineSecondary"
								onClick={onExportBundle}
							>
								<IoArchiveOutline aria-hidden className="h-3.5 w-3.5" />
							</MapControlIconButton>
						)}
					</div>
				</>
			)}
			{rulerKms && (
				<>
					<label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
						<Checkbox checked={attachRuler} onCheckedChange={onAttachRulerChange} />
						{t('attachRuler', { range: `${fmtDisplayKm(rulerKms.lo)} - ${fmtDisplayKm(rulerKms.hi)}` })}
					</label>
					{!value.trackLink && importedTracks.length > 0 && (
						<label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
							<Checkbox checked={useRulerOnTrack} onCheckedChange={(checked) => setUseRulerOnTrack(checked)} />
							{t('journalLinkRulerIntersect')}
						</label>
					)}
				</>
			)}
			<input
				accept=".gpx,application/gpx+xml"
				className="hidden"
				ref={fileInputRef}
				type="file"
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) void handleImportGpx(file);
					e.target.value = '';
				}}
			/>
			{error && <p className={cn('text-cldt-red m-0 text-xs')}>{error}</p>}
		</div>
	);
}
