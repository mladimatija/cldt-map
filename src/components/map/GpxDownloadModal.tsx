'use client';

/**
 * Disclaimer modal shown before any GPX download.
 * The user must acknowledge the terms before the download is triggered.
 */
import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { usePopoverFocusTrap } from '@/hooks';
import { canShareGpxFiles } from '@/lib/gpx-export';

interface GpxDownloadModalProps {
	isOpen: boolean;
	onClose: () => void;
	onConfirm: () => void;
	/** Optional share-sheet handoff (Web Share API). The button renders only
	 *  when provided AND the platform can share GPX files. */
	onShare?: () => void;
}

const DISCLAIMER_ITEM_KEYS = [
	'disclaimerItem1',
	'disclaimerItem2',
	'disclaimerItem3',
	'disclaimerItem4',
	'disclaimerItem5',
	'disclaimerItem6',
	'disclaimerItem7',
	'disclaimerItem8',
	'disclaimerItem9',
] as const;

export function GpxDownloadModal({
	isOpen,
	onClose,
	onConfirm,
	onShare,
}: GpxDownloadModalProps): React.ReactElement | null {
	const t = useTranslations('gpxDownload');
	const [acknowledged, setAcknowledged] = useState(false);
	const shareSupported = onShare !== undefined && canShareGpxFiles();
	const cardRef = usePopoverFocusTrap(isOpen);

	useEffect(() => {
		if (!isOpen) return;
		queueMicrotask(() => setAcknowledged(false));
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) return;
		const handler = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [isOpen, onClose]);

	if (!isOpen) return null;

	const handleConfirm = (): void => {
		if (!acknowledged) return;
		onConfirm();
		onClose();
	};

	const handleShare = (): void => {
		if (!acknowledged || !onShare) return;
		onShare();
		onClose();
	};

	return (
		<div
			aria-labelledby="gpx-download-title"
			aria-modal="true"
			className="z-modal fixed inset-0 flex items-center justify-center bg-[var(--modal-backdrop-bg)] p-4"
			role="dialog"
			onClick={onClose}
		>
			<div
				className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded bg-[var(--map-tooltip-bg)] p-4 shadow-xl dark:bg-[var(--bg-primary)]"
				ref={cardRef}
				onClick={(e) => e.stopPropagation()}
			>
				<h3
					className="text-cldt-blue mb-2 text-base font-semibold dark:text-[var(--text-primary)]"
					id="gpx-download-title"
				>
					{t('modalTitle')}
				</h3>

				<p className="mb-3 text-xs text-gray-600 dark:text-[var(--text-secondary)]">{t('disclaimerIntro')}</p>
				<ul className="mb-4 space-y-1 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
					{DISCLAIMER_ITEM_KEYS.map((key) => (
						<li className="flex gap-2" key={key}>
							<span className="text-cldt-blue mt-0.5 shrink-0">•</span>
							<span>{t(key)}</span>
						</li>
					))}
				</ul>

				<label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-[var(--text-primary)]">
					<Checkbox checked={acknowledged} onCheckedChange={setAcknowledged} />
					<span>{t('acknowledgmentLabel')}</span>
				</label>

				<div className="flex justify-end gap-2">
					<Button size="sm" variant="mapControlOutlineSecondary" onClick={onClose}>
						{t('cancelButton')}
					</Button>
					{shareSupported && (
						<Button disabled={!acknowledged} size="sm" variant="mapControlOutlineSecondary" onClick={handleShare}>
							{t('shareButton')}
						</Button>
					)}
					<Button disabled={!acknowledged} size="sm" variant="mapControlOutline" onClick={handleConfirm}>
						{t('downloadButton')}
					</Button>
				</div>
			</div>
		</div>
	);
}
