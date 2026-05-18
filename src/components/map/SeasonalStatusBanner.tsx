'use client';

import React, { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import {
	formatSeasonalDateRange,
	resolveSeasonalNote,
	severityColor,
	severityRank,
	type SeasonalStatusEntry,
} from '@/lib/seasonal-status';

/**
 * Renders a non-dismissible banner chip when the user's GPS-snapped position
 * falls inside a `closed_recommended` or `experts_only` seasonal entry.
 * Tapping the banner opens the seasonal-status modal.
 */
export function SeasonalStatusBanner(): React.ReactElement | null {
	const t = useTranslations('seasonalStatus');
	const locale = useLocale();
	const closestPoint = useStore((s: StoreState) => s.closestPoint);
	const entries = useMapStore((s: MapStoreState) => s.seasonalStatusEntries);
	const setSeasonalStatusModalEntry = useMapStore((s: MapStoreState) => s.setSeasonalStatusModalEntry);

	const active = useMemo((): SeasonalStatusEntry[] => {
		if (!closestPoint) return [];
		if (entries.length === 0) return [];

		const kmFromSobo = closestPoint.distanceFromStart / 1000;

		const inRange = entries.filter((e) => {
			if (e.severity !== 'closed_recommended' && e.severity !== 'experts_only') return false;
			if (typeof e.distanceStartKm !== 'number' || typeof e.distanceEndKm !== 'number') return false;
			return kmFromSobo >= e.distanceStartKm && kmFromSobo <= e.distanceEndKm;
		});

		return inRange.slice().sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
	}, [closestPoint, entries]);

	if (active.length === 0) return null;

	return (
		<div aria-label={t('bannerPrefix')} className="relative z-[var(--z-banner)]" role="region">
			{active.map((entry) => {
				const severityLabel = t(`severity.${entry.severity}`);
				const note = resolveSeasonalNote(entry, locale);
				const dateRange = formatSeasonalDateRange(entry.validFrom, entry.validUntil, locale);
				const validLabel = t('validLabel');
				const hoverTitle = buildHoverTitle({
					prefix: t('bannerPrefix'),
					severityLabel,
					source: entry.source,
					note,
					validLabel,
					dateRange,
					gearLabel: entry.gear ? t('gearLabel') : null,
					gear: entry.gear,
				});
				const buttonLabel = `${t('bannerPrefix')} ${severityLabel} - ${entry.source} - ${t('tapForDetails')}`;
				return (
					<div key={entry.id} role="alert" style={{ backgroundColor: severityColor(entry.severity) }}>
						<button
							aria-label={buttonLabel}
							className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-inset"
							title={hoverTitle}
							type="button"
							onClick={() => setSeasonalStatusModalEntry(entry)}
						>
							<div className="min-w-0 flex-1">
								<span className="font-semibold">{t('bannerPrefix')}</span>
								<span className="ml-1">{severityLabel}</span>
								{entry.source && <span className="ml-1 opacity-90">- {entry.source}</span>}
								{note && <span className="mt-0.5 block truncate text-xs opacity-90">{note}</span>}
								<span className="mt-0.5 block text-xs opacity-80">
									{validLabel} {dateRange}
								</span>
							</div>
						</button>
					</div>
				);
			})}
		</div>
	);
}

interface HoverTitleArgs {
	prefix: string;
	severityLabel: string;
	source: string;
	note: string;
	validLabel: string;
	dateRange: string;
	gearLabel: string | null;
	gear: string | undefined;
}

/**
 * Multi-line tooltip body (via the HTML `title` attribute) so a hovering user
 * sees full context without opening the modal.
 */
function buildHoverTitle(args: HoverTitleArgs): string {
	const lines: string[] = [`${args.prefix} ${args.severityLabel}`, `${args.validLabel} ${args.dateRange}`];
	if (args.note) lines.push('', args.note);
	if (args.gearLabel && args.gear) lines.push('', `${args.gearLabel}: ${args.gear}`);
	if (args.source) lines.push('', args.source);
	return lines.join('\n');
}
