'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { MAP_CONTROL_POPOVER } from './map-controls-constants';
import { usePopoverFocusTrap } from '@/hooks';

/**
 * Topic-grouped help panel behind the ? control. The app's features hide
 * behind icon-only buttons and three invisible gestures (SOS long-press,
 * GPX drag-and-drop, chart-drag ruler); hover tooltips never reach mobile
 * users, so this panel is the always-available reference. The elevation
 * chart section reuses the existing mapControls.helpItems strings - the
 * chart's own contextual help block shows the same text in place.
 */
export function MapControlsHelpPanel(): React.ReactElement {
	const t = useTranslations('help');
	const tControls = useTranslations('mapControls');
	const popoverRef = usePopoverFocusTrap(true);

	const kbd = (chunks: React.ReactNode): React.ReactElement => (
		<kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-[11px] text-gray-700 dark:border-[var(--border-color)] dark:bg-[var(--bg-primary)] dark:text-[var(--text-primary)]">
			{chunks}
		</kbd>
	);

	const section = (heading: string, items: [string, React.ReactNode][]): React.ReactElement => (
		<div key={heading}>
			<p className="m-0 text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">{heading}</p>
			<ul className="mt-1 space-y-1 text-xs leading-snug text-gray-600 dark:text-[var(--text-secondary)]">
				{items.map(([key, item]) => (
					<li key={key}>{item}</li>
				))}
			</ul>
		</div>
	);

	return (
		<div
			aria-labelledby="help-panel-title"
			aria-modal="true"
			className={`z-controls-popover fixed top-2 right-16 flex max-h-[calc(100dvh-4rem)] w-80 flex-col gap-3 overflow-y-auto ${MAP_CONTROL_POPOVER}`}
			ref={popoverRef}
			role="dialog"
			onContextMenu={(e) => e.preventDefault()}
		>
			<h3 className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]" id="help-panel-title">
				{t('title')}
			</h3>

			{section(t('basicsHeading'), [
				['layers', t('basics.layers')],
				['trail', t('basics.trail')],
				['settings', t('basics.settings')],
			])}

			{section(t('chartHeading'), [
				['trailClick', tControls('helpItems.trailClick')],
				['chartHover', tControls('helpItems.chartHover')],
				['chartClickPin', tControls('helpItems.chartClickPin')],
				['chartDragRuler', tControls('helpItems.chartDragRuler')],
				['escCancelRuler', tControls.rich('helpItems.escCancelRuler', { kbd })],
			])}

			{section(t('gesturesHeading'), [
				['sos', t('gestures.sos')],
				['gpxDrop', t('gestures.gpxDrop')],
				['poiList', t('gestures.poiList')],
			])}

			{section(t('planningHeading'), [
				['planner', t('planning.planner')],
				['tripBrief', t('planning.tripBrief')],
				['progress', t('planning.progress')],
			])}

			{section(t('offlineHeading'), [
				['precache', t('offline.precache')],
				['gps', t('offline.gps')],
			])}
		</div>
	);
}
