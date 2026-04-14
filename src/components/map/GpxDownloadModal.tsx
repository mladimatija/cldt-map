'use client';

/**
 * Disclaimer modal shown before any GPX download.
 * The user must acknowledge the terms before the download is triggered.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { useBlockMapPropagation } from '@/hooks';

interface GpxDownloadModalProps {
	isOpen: boolean;
	onClose: () => void;
	onConfirm: () => void;
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

export function GpxDownloadModal({ isOpen, onClose, onConfirm }: GpxDownloadModalProps): React.ReactElement | null {
	const t = useTranslations('gpxDownload');
	const [acknowledged, setAcknowledged] = useState(false);
	const backdropRef = useRef<HTMLDivElement>(null);
	const dialogRef = useRef<HTMLDivElement>(null);
	const checkboxRef = useRef<HTMLInputElement>(null);

	useBlockMapPropagation(backdropRef, [isOpen]);

	useEffect(() => {
		if (!isOpen) return;
		queueMicrotask(() => setAcknowledged(false));
	}, [isOpen]);

	useEffect(() => {
		if (isOpen) {
			setTimeout(() => checkboxRef.current?.focus(), 50);
		}
	}, [isOpen]);

	// Close on Escape
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

	return (
		<div
			aria-modal="true"
			className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-black/50 p-4"
			ref={backdropRef}
			role="dialog"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-[var(--bg-primary)]"
				ref={dialogRef}
			>
				<div className="border-b border-gray-200 px-6 py-4 dark:border-[var(--border-color)]">
					<h2 className="text-cldt-blue mb-0 text-lg leading-none font-semibold">{t('modalTitle')}</h2>
				</div>

				<div className="flex-1 overflow-y-auto px-6 py-4">
					<p className="mb-3 text-sm text-gray-700 dark:text-[var(--text-secondary)]">{t('disclaimerIntro')}</p>
					<ul className="mb-4 space-y-1.5 text-sm text-gray-700 dark:text-[var(--text-secondary)]">
						{DISCLAIMER_ITEM_KEYS.map((key) => (
							<li className="flex gap-2" key={key}>
								<span className="text-cldt-blue mt-0.5 shrink-0">•</span>
								<span>{t(key)}</span>
							</li>
						))}
					</ul>

					<label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-[var(--border-color)]">
						<input
							checked={acknowledged}
							className="accent-cldt-green mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
							ref={checkboxRef}
							type="checkbox"
							onChange={(e) => setAcknowledged(e.target.checked)}
						/>
						<span className="text-sm font-medium text-gray-800 dark:text-[var(--text-primary)]">
							{t('acknowledgmentLabel')}
						</span>
					</label>
				</div>

				<div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-[var(--border-color)]">
					<Button size="default" variant="base" onClick={onClose}>
						{t('cancelButton')}
					</Button>
					<Button
						disabled={!acknowledged}
						size="default"
						variant={acknowledged ? 'mapControlOutline' : 'base'}
						onClick={handleConfirm}
					>
						{t('downloadButton')}
					</Button>
				</div>
			</div>
		</div>
	);
}
