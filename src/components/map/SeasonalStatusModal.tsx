'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { formatSeasonalDateRange, resolveSeasonalNote, severityColor } from '@/lib/seasonal-status';
import { isSafeUrl } from '@/lib/utils';
import { MapControlModalShell } from '@/components/map/controls/MapControlModalShell';

export function SeasonalStatusModal(): React.ReactElement | null {
	const t = useTranslations('seasonalStatus');
	const tCommon = useTranslations('common');
	const locale = useLocale();
	const entry = useMapStore((s: MapStoreState) => s.seasonalStatusModalEntry);
	const setSeasonalStatusModalEntry = useMapStore((s: MapStoreState) => s.setSeasonalStatusModalEntry);

	if (!entry) return null;

	const note = resolveSeasonalNote(entry, locale);
	const accent = severityColor(entry.severity);
	const showSourceLink = isSafeUrl(entry.sourceUrl);
	const dateRange = formatSeasonalDateRange(entry.validFrom, entry.validUntil, locale);
	const close = (): void => setSeasonalStatusModalEntry(null);
	const closeLabel = tCommon('close');

	return (
		<MapControlModalShell
			open
			showCloseButton
			cardClassName="map-tooltip seasonal-status-popout relative w-full max-w-lg text-left"
			cardStyle={{ '--seasonal-accent': accent } as React.CSSProperties}
			closeLabel={closeLabel}
			title={t(`severity.${entry.severity}`)}
			titleClassName="mb-1.5 pr-6 text-xs font-semibold tracking-wide uppercase"
			titleId="seasonal-status-modal-title"
			titleStyle={{ color: accent }}
			onClose={close}
		>
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
		</MapControlModalShell>
	);
}
