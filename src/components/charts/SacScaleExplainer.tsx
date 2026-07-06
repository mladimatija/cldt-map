'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { SAC_BUCKETS } from '@/components/charts/elevation-chart-shared';
import { SAC_BUCKET_SHORT_LABELS, SAC_COLORS } from '@/components/map/trail-route-constants';

/**
 * Plain-language explainer for the six SAC (Swiss Alpine Club) hiking grades,
 * shown behind a native <details> disclosure inside the SAC colour legend
 * (both the settings trail-appearance card and the elevation-chart legend).
 * Keeps the legend compact by default while giving each T-grade a one-line
 * description of footing, exposure, scrambling, and gear on demand.
 */
export function SacScaleExplainer(): React.ReactElement {
	const t = useTranslations('mapControls');
	// The synthetic 'untagged' bucket has no SAC grade, so drop it here.
	const grades = SAC_BUCKETS.filter((key) => key !== 'untagged');
	return (
		<details className="mt-1">
			<summary className="focus-visible:ring-cldt-green cursor-pointer rounded text-xs font-medium text-gray-600 outline-none focus-visible:ring-1 focus-visible:ring-offset-1 dark:text-[var(--text-secondary)]">
				{t('layers.trailStyle.sacExplainerToggle')}
			</summary>
			<div className="mt-1 flex flex-col gap-1.5">
				{grades.map((key) => (
					<div className="flex items-start gap-2" key={key}>
						<span
							aria-hidden="true"
							className="mt-0.5 inline-block h-2 w-6 shrink-0 rounded-sm"
							style={{ backgroundColor: SAC_COLORS[key] }}
						/>
						<span className="min-w-0">
							<span className="font-medium text-gray-700 dark:text-[var(--text-primary)]">
								<span className="font-mono">{SAC_BUCKET_SHORT_LABELS[key]}</span>{' '}
								{t(`layers.trailStyle.sacBuckets.${key}`)}
							</span>
							<span className="block opacity-90">{t(`layers.trailStyle.sacDescriptions.${key}`)}</span>
						</span>
					</div>
				))}
			</div>
		</details>
	);
}
