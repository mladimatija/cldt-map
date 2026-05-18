'use client';

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { formatSeasonalDateRange, resolveSeasonalNote, severityColor } from '@/lib/seasonal-status';
import { isSafeUrl } from '@/lib/utils';
import { usePopoverFocusTrap } from '@/hooks/usePopoverFocusTrap';
import { Button } from '@/components/ui/Button';

export function SeasonalStatusModal(): React.ReactElement | null {
	const t = useTranslations('seasonalStatus');
	const tCommon = useTranslations('common');
	const locale = useLocale();
	const entry = useMapStore((s: MapStoreState) => s.seasonalStatusModalEntry);
	const setSeasonalStatusModalEntry = useMapStore((s: MapStoreState) => s.setSeasonalStatusModalEntry);
	const cardRef = usePopoverFocusTrap(entry !== null);
	const previouslyFocusedRef = useRef<HTMLElement | null>(null);

	// Capture the trigger synchronously before usePopoverFocusTrap moves focus
	// inside the modal; otherwise the saved element would be inside the dialog.
	useLayoutEffect(() => {
		if (!entry) return;
		previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
	}, [entry]);

	useEffect(() => {
		if (!entry) return;
		const onKeydown = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') setSeasonalStatusModalEntry(null);
		};
		document.addEventListener('keydown', onKeydown);
		return () => {
			document.removeEventListener('keydown', onKeydown);
			previouslyFocusedRef.current?.focus();
			previouslyFocusedRef.current = null;
		};
	}, [entry, setSeasonalStatusModalEntry]);

	if (!entry) return null;

	const note = resolveSeasonalNote(entry, locale);
	const accent = severityColor(entry.severity);
	const showSourceLink = isSafeUrl(entry.sourceUrl);
	const dateRange = formatSeasonalDateRange(entry.validFrom, entry.validUntil, locale);
	const close = (): void => setSeasonalStatusModalEntry(null);
	const closeLabel = tCommon('close');

	return (
		<div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/40 p-4" onClick={close}>
			<div
				aria-labelledby="seasonal-status-modal-title"
				aria-modal="true"
				className="map-tooltip seasonal-status-popout relative w-full text-left"
				ref={cardRef}
				role="dialog"
				style={{ '--seasonal-accent': accent } as React.CSSProperties}
				onClick={(e) => e.stopPropagation()}
			>
				<Button aria-label={closeLabel} className="user-location-close-btn" variant="closeIcon" onClick={close}>
					×
				</Button>
				<p
					className="mb-1.5 pr-6 text-xs font-semibold tracking-wide uppercase"
					id="seasonal-status-modal-title"
					style={{ color: accent }}
				>
					{t(`severity.${entry.severity}`)}
				</p>
				<p>{note}</p>
				<p className="mt-1.5 text-xs opacity-75">
					<span className="font-medium">{t('validLabel')}</span> {dateRange}
				</p>
				{entry.gear && (
					<p className="mt-1.5">
						<span className="font-medium">{t('gearLabel')}:</span> {entry.gear}
					</p>
				)}
				<p className="mt-2 text-xs opacity-75">
					<span className="font-medium">{t('sourceLabel')}:</span> {entry.source}
					{showSourceLink && (
						<>
							{' - '}
							<a
								className="text-cldt-blue hover:text-cldt-green focus-visible:text-cldt-green underline transition-colors duration-200"
								href={entry.sourceUrl}
								rel="noopener noreferrer"
								target="_blank"
							>
								{entry.sourceUrl}
							</a>
						</>
					)}
				</p>
			</div>
		</div>
	);
}
