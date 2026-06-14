'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { importGpxFileAsTrack } from '@/lib/imported-tracks';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { Button } from '@/components/ui/Button';

export default function GpxImportDropzone(): React.ReactElement {
	const t = useTranslations('imports');
	const addImportedTrack = useMapStore((s: MapStoreState) => s.addImportedTrack);

	const [isDragging, setIsDragging] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const dragCounter = useRef(0);
	const fileInputRef = useRef<HTMLInputElement>(null);

	async function processFile(file: File): Promise<string | null> {
		// getState() reads synchronously, so sequential batch imports see
		// each other immediately - the ref-based count only updates after a
		// render and would hand every file in a batch the same color.
		const currentTracks = useMapStore.getState().importedTracks;
		const result = await importGpxFileAsTrack(file, currentTracks);
		if (result.status === 'ok') {
			if (result.isNew) addImportedTrack(result.track);
			return null;
		}
		if (result.status === 'tooLarge') return t('errorTooLarge');
		return t('errorMalformed');
	}

	/** Imports a batch sequentially: order keeps the palette color cycle
	 *  deterministic and one malformed file never aborts the rest. Errors
	 *  are aggregated into a single banner naming the failing files. */
	async function processFiles(files: File[]): Promise<void> {
		setError(null);
		const failures: string[] = [];
		for (const file of files) {
			const err = await processFile(file);
			if (err) failures.push(`${file.name}: ${err}`);
		}
		if (failures.length > 0) setError(failures.join('\n'));
	}

	useEffect(() => {
		const onDragEnter = (e: DragEvent): void => {
			e.preventDefault();
			dragCounter.current++;
			if (e.dataTransfer?.types.includes('Files')) setIsDragging(true);
		};
		const onDragOver = (e: DragEvent): void => {
			e.preventDefault();
		};
		const onDragLeave = (): void => {
			dragCounter.current--;
			if (dragCounter.current <= 0) {
				dragCounter.current = 0;
				setIsDragging(false);
			}
		};
		const onDrop = (e: DragEvent): void => {
			e.preventDefault();
			dragCounter.current = 0;
			setIsDragging(false);
			const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.name.toLowerCase().endsWith('.gpx'));
			if (files.length === 0) return;
			void processFiles(files);
		};

		document.addEventListener('dragenter', onDragEnter);
		document.addEventListener('dragover', onDragOver);
		document.addEventListener('dragleave', onDragLeave);
		document.addEventListener('drop', onDrop);
		return () => {
			document.removeEventListener('dragenter', onDragEnter);
			document.removeEventListener('dragover', onDragOver);
			document.removeEventListener('dragleave', onDragLeave);
			document.removeEventListener('drop', onDrop);
		};
		// processFile is stable (refs only); no dependency on importedTracks.length
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const onFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
		const files = Array.from(e.target.files ?? []);
		if (files.length > 0) void processFiles(files);
		e.target.value = '';
	};

	return (
		<>
			{/* Hidden file picker - triggered from MapControlsImportsPanel */}
			<input
				multiple
				accept=".gpx"
				aria-label={t('pickFile')}
				className="sr-only"
				id="gpx-file-input"
				ref={fileInputRef}
				type="file"
				onChange={onFileChange}
			/>
			{isDragging && (
				<div
					aria-hidden
					className="pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center border-4 border-dashed border-[var(--cldt-green)] bg-white/30 backdrop-blur-sm dark:bg-black/30"
				>
					<span className="rounded-lg bg-white/90 px-6 py-3 text-lg font-semibold text-gray-800 shadow dark:bg-[var(--bg-primary)]/90 dark:text-white">
						{t('dropToImport')}
					</span>
				</div>
			)}
			{error && (
				<div
					aria-live="polite"
					className="map-tooltip map-tooltip--banner map-tooltip--error animate-slide-in-from-top"
					role="alert"
				>
					<Button className="user-location-close-btn" variant="closeIcon" onClick={() => setError(null)}>
						×
					</Button>
					<span className="whitespace-pre-line">{error}</span>
				</div>
			)}
		</>
	);
}
