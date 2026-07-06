'use client';

import React, { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { IoWarningOutline } from 'react-icons/io5';
import { Button } from '@/components/ui/Button';
import { ExternalLink } from '@/components/ui/ExternalLink';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { isFeedStale } from '@/lib/data-freshness';
import { formatIsoDate } from '@/lib/date-format';
import { isSafeUrl } from '@/lib/utils';
import { SIGURNE_STAZE_URL } from '@/lib/official-sources';
import { BANNER_REGION_CLASSES, BANNER_ROW_CLASSES } from './banner-styles';

/**
 * Honest-staleness chip for the seasonal-status feed. When the layer is on but
 * the feed's own lastUpdated date is older than the staleness threshold (e.g. the
 * hiker has been offline for weeks on bundled data, or the curator has not
 * refreshed), it warns that "no closure shown" may simply mean "not refreshed" -
 * so the hiker cross-checks the official source rather than assuming all-clear.
 *
 * Stays hidden in normal use (fresh feed), when the layer is off, and once
 * dismissed for the session. Uses the date-age check (robust offline) rather than
 * trying to detect bundled-vs-network, which a warm cache makes unreliable.
 */
export function SeasonalStatusFreshnessBanner(): React.ReactElement | null {
	const t = useTranslations('seasonalStatus');
	const locale = useLocale();
	const enabled = useMapStore((s: MapStoreState) => s.seasonalStatusLayerEnabled);
	const file = useMapStore((s: MapStoreState) => s.seasonalStatusFile);
	const [dismissed, setDismissed] = useState(false);
	// Capture "now" once at mount (lazy initializer keeps Date.now() out of render).
	const [now] = useState<number>(() => Date.now());

	const lastUpdated = file?.lastUpdated;
	if (!enabled || dismissed || !lastUpdated || !isFeedStale(lastUpdated, now)) {
		return null;
	}

	return (
		<div aria-label={t('freshness.label')} className={BANNER_REGION_CLASSES} role="region">
			<div className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" role="status">
				<div className={BANNER_ROW_CLASSES}>
					<IoWarningOutline aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
					<span className="min-w-0 flex-1 text-xs">
						{t.rich('freshness.stale', {
							date: formatIsoDate(lastUpdated, locale),
							source: (chunks) =>
								isSafeUrl(SIGURNE_STAZE_URL) ? <ExternalLink href={SIGURNE_STAZE_URL}>{chunks}</ExternalLink> : chunks,
						})}
					</span>
					<Button aria-label={t('freshness.dismiss')} variant="bannerClose" onClick={() => setDismissed(true)}>
						×
					</Button>
				</div>
			</div>
		</div>
	);
}
