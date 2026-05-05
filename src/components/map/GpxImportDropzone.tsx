'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { parseGpx } from '@/lib/gpx-parser';
import { saveImportedTrack } from '@/lib/imported-tracks';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { Button } from '@/components/ui/Button';

export default function GpxImportDropzone(): React.ReactElement {
	const t = useTranslations('imports');
	const importedTracks = useMapStore((s: MapStoreState) => s.importedTracks);
	const addImportedTrack = useMapStore((s: MapStoreState) => s.addImportedTrack);

	const [isDragging, setIsDragging] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const dragCounter = useRef(0);
	// Ref so drag handlers don't need to re-register on every track addition
	const trackCountRef = useRef(importedTracks.length);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		trackCountRef.current = importedTracks.length;
	}, [importedTracks.length]);

	async function processFile(file: File): Promise<void> {
		const xml = await file.text();
		try {
			const parsed = parseGpx(xml);
			const firstTrack = parsed.tracks[0];
			if (!firstTrack || firstTrack.points.length === 0) {
				setError(t('errorMalformed'));
				return;
			}
			const track = await saveImportedTrack(xml, firstTrack, trackCountRef.current);
			addImportedTrack(track);
		} catch (err) {
			const msg = err instanceof Error ? err.message : '';
			setError(msg.includes('large') ? t('errorTooLarge') : t('errorMalformed'));
		}
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
			const file = Array.from(e.dataTransfer?.files ?? []).find((f) => f.name.endsWith('.gpx'));
			if (!file) return;
			void processFile(file);
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
		const file = e.target.files?.[0];
		if (file) void processFile(file);
		e.target.value = '';
	};

	return (
		<>
			{/* Hidden file picker — triggered from MapControlsImportsPanel */}
			<input
				ref={fileInputRef}
				accept=".gpx"
				aria-label={t('pickFile')}
				className="sr-only"
				id="gpx-file-input"
				type="file"
				onChange={onFileChange}
			/>
			{isDragging && (
				<div
					aria-hidden
					className="pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center border-4 border-dashed border-[var(--cldt-green)] bg-white/30 backdrop-blur-sm dark:bg-black/30"
				>
					<span className="rounded-lg bg-white/90 px-6 py-3 text-lg font-semibold text-gray-800 shadow dark:bg-gray-900/90 dark:text-white">
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
					<span>{error}</span>
				</div>
			)}
		</>
	);
}