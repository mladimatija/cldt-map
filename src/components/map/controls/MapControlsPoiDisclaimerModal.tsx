'use client';

import React, { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { usePopoverFocusTrap } from '@/hooks';

/** "FarOut mobile app" deep-link target. The LDTH's Croatian-language page is
 *  the canonical source; all non-HR locales fall back to the English mirror. */
function getFarOutAppUrl(locale: string): string {
	if (locale === 'hr') return 'https://cldt.hr/orijentacija-mobilna-aplikacija/';
	return 'https://cldt.hr/en/navigation-mobile-app/';
}

interface MapControlsPoiDisclaimerModalProps {
	open: boolean;
	onCancel: () => void;
	onConfirm: () => void;
	onDismissFor30Days: () => void;
}

/**
 * Modal shown the first time the user enables the POI map layer (and again
 * after a 30-day dismissal window expires).
 */
export function MapControlsPoiDisclaimerModal({
	open,
	onCancel,
	onConfirm,
	onDismissFor30Days,
}: MapControlsPoiDisclaimerModalProps): React.ReactElement | null {
	const t = useTranslations('poiDisclaimer');
	const locale = useLocale();
	const farOutUrl = getFarOutAppUrl(locale);
	const dialogRef = usePopoverFocusTrap(open);

	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') onCancel();
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [open, onCancel]);

	if (!open) return null;

	return (
		<div
			aria-labelledby="poi-disclaimer-title"
			aria-modal="true"
			className="z-modal fixed inset-0 flex items-center justify-center bg-[var(--modal-backdrop-bg)] p-4"
			ref={dialogRef}
			role="dialog"
			onClick={onCancel}
		>
			<div
				className="w-full max-w-sm rounded bg-[var(--map-tooltip-bg)] p-4 shadow-xl dark:bg-[var(--bg-primary)]"
				onClick={(e) => e.stopPropagation()}
			>
				<h3
					className="text-cldt-blue mb-2 text-base font-semibold dark:text-[var(--text-primary)]"
					id="poi-disclaimer-title"
				>
					{t('title')}
				</h3>
				<p className="mb-2 text-xs text-gray-700 dark:text-[var(--text-primary)]">{t('publicSource')}</p>
				<p className="mb-3 text-xs text-gray-700 dark:text-[var(--text-primary)]">
					{t.rich('farOut', {
						link: (chunks) => (
							<a
								className="text-cldt-blue underline hover:no-underline"
								href={farOutUrl}
								rel="noopener noreferrer"
								target="_blank"
							>
								{chunks}
							</a>
						),
					})}
				</p>
				<div className="flex flex-col gap-2">
					<Button size="sm" variant="mapControlOutline" onClick={onConfirm}>
						{t('confirm')}
					</Button>
					<Button size="sm" variant="mapControlOutline" onClick={onDismissFor30Days}>
						{t('dismiss30')}
					</Button>
					<Button size="sm" variant="mapControlOutlineSecondary" onClick={onCancel}>
						{t('cancel')}
					</Button>
				</div>
			</div>
		</div>
	);
}
