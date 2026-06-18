'use client';

import React, { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { IoArrowForwardOutline } from 'react-icons/io5';
import { Link } from '@/i18n/navigation';
import { MAP_CONTROL_LINK_BUTTON, MAP_CONTROL_PANEL_WIDTH, MAP_CONTROL_POPOVER } from './map-controls-constants';
import { MapControlSectionCard } from './MapControlSectionCard';
import { usePopoverFocusTrap } from '@/hooks';
import { cn } from '@/lib/utils';
import { INLINE_LINK_CLASS } from '@/components/ui/ExternalLink';
import { useMapStore, type MapStoreState } from '@/lib/store';

function HelpKbd({ children }: { children: React.ReactNode }): React.ReactElement {
	return (
		<kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-[0.6875rem] text-gray-700 dark:border-[var(--border-color)] dark:bg-[var(--bg-primary)] dark:text-[var(--text-primary)]">
			{children}
		</kbd>
	);
}

function HelpList({ items }: { items: [string, React.ReactNode][] }): React.ReactElement {
	return (
		<ul className="m-0 list-none space-y-1 p-0 text-xs leading-snug text-gray-600 dark:text-[var(--text-secondary)]">
			{items.map(([key, item]) => (
				<li key={key}>{item}</li>
			))}
		</ul>
	);
}

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
	const tProgress = useTranslations('progress');
	const popoverRef = usePopoverFocusTrap(true);

	const helpPanelBasicsOpen = useMapStore((state: MapStoreState) => state.helpPanelBasicsOpen);
	const setHelpPanelBasicsOpen = useMapStore((state: MapStoreState) => state.setHelpPanelBasicsOpen);
	const helpPanelChartOpen = useMapStore((state: MapStoreState) => state.helpPanelChartOpen);
	const setHelpPanelChartOpen = useMapStore((state: MapStoreState) => state.setHelpPanelChartOpen);
	const helpPanelGesturesOpen = useMapStore((state: MapStoreState) => state.helpPanelGesturesOpen);
	const setHelpPanelGesturesOpen = useMapStore((state: MapStoreState) => state.setHelpPanelGesturesOpen);
	const helpPanelPlanningOpen = useMapStore((state: MapStoreState) => state.helpPanelPlanningOpen);
	const setHelpPanelPlanningOpen = useMapStore((state: MapStoreState) => state.setHelpPanelPlanningOpen);
	const helpPanelOfflineOpen = useMapStore((state: MapStoreState) => state.helpPanelOfflineOpen);
	const setHelpPanelOfflineOpen = useMapStore((state: MapStoreState) => state.setHelpPanelOfflineOpen);
	const helpPanelDemoOpen = useMapStore((state: MapStoreState) => state.helpPanelDemoOpen);
	const setHelpPanelDemoOpen = useMapStore((state: MapStoreState) => state.setHelpPanelDemoOpen);
	const helpScrollTarget = useMapStore((state: MapStoreState) => state.helpScrollTarget);
	const clearHelpScrollTarget = useMapStore((state: MapStoreState) => state.clearHelpScrollTarget);
	const setOpenPanel = useMapStore((state: MapStoreState) => state.setOpenPanel);

	// "Start here" launcher: deep-link into the most useful panels (mutual
	// exclusion in the store closes help and opens the target).
	const startHereRows = [
		{ key: 'plan', panel: 'stagePlanner' },
		{ key: 'places', panel: 'poiList' },
		{ key: 'progress', panel: 'progress' },
		{ key: 'offline', panel: 'settings' },
	] as const;

	const sectionCollapseLabel = tProgress('collapseSection');

	useEffect(() => {
		if (helpScrollTarget !== 'planning') return;
		setHelpPanelPlanningOpen(true);
		const el = document.getElementById('help-planning-section');
		el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		clearHelpScrollTarget();
	}, [helpScrollTarget, clearHelpScrollTarget, setHelpPanelPlanningOpen]);
	const sectionExpandLabel = tProgress('expandSection');

	return (
		<div
			aria-labelledby="help-panel-title"
			aria-modal="true"
			className={`z-controls-popover fixed top-2 right-16 flex max-h-[calc(100dvh-4rem)] ${MAP_CONTROL_PANEL_WIDTH} flex-col gap-2 overflow-y-auto ${MAP_CONTROL_POPOVER}`}
			ref={popoverRef}
			role="dialog"
			onContextMenu={(e) => e.preventDefault()}
		>
			<h3 className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]" id="help-panel-title">
				{t('title')}
			</h3>

			<MapControlSectionCard title={t('startHereHeading')}>
				<div className="flex flex-col gap-0.5">
					{startHereRows.map(({ key, panel }) => (
						<button
							className={cn(MAP_CONTROL_LINK_BUTTON, 'flex w-full items-center gap-2')}
							key={key}
							type="button"
							onClick={() => setOpenPanel(panel)}
						>
							<IoArrowForwardOutline aria-hidden className="h-3.5 w-3.5 shrink-0" />
							{t(`start.${key}`)}
						</button>
					))}
				</div>
			</MapControlSectionCard>

			<MapControlSectionCard
				collapsible
				collapseLabel={sectionCollapseLabel}
				expandLabel={sectionExpandLabel}
				open={helpPanelBasicsOpen}
				title={t('basicsHeading')}
				onOpenChange={setHelpPanelBasicsOpen}
			>
				<HelpList
					items={[
						['layers', t('basics.layers')],
						['terrainOverlays', t('basics.terrainOverlays')],
						['trail', t('basics.trail')],
						['share', t('basics.share')],
						['settings', t('basics.settings')],
					]}
				/>
			</MapControlSectionCard>

			<MapControlSectionCard
				collapsible
				collapseLabel={sectionCollapseLabel}
				expandLabel={sectionExpandLabel}
				open={helpPanelChartOpen}
				title={t('chartHeading')}
				onOpenChange={setHelpPanelChartOpen}
			>
				<HelpList
					items={[
						['trailClick', tControls('helpItems.trailClick')],
						['chartHover', tControls('helpItems.chartHover')],
						['chartOsmTooltip', tControls('helpItems.chartOsmTooltip')],
						['chartClickPin', tControls('helpItems.chartClickPin')],
						['chartDragRuler', tControls('helpItems.chartDragRuler')],
						[
							'escCancelRuler',
							tControls.rich('helpItems.escCancelRuler', {
								kbd: (chunks) => <HelpKbd>{chunks}</HelpKbd>,
							}),
						],
					]}
				/>
			</MapControlSectionCard>

			<MapControlSectionCard
				collapsible
				collapseLabel={sectionCollapseLabel}
				expandLabel={sectionExpandLabel}
				open={helpPanelGesturesOpen}
				title={t('gesturesHeading')}
				onOpenChange={setHelpPanelGesturesOpen}
			>
				<HelpList
					items={[
						['sos', t('gestures.sos')],
						['gpxDrop', t('gestures.gpxDrop')],
						['poiList', t('gestures.poiList')],
						['waypoint', t('gestures.waypoint')],
					]}
				/>
			</MapControlSectionCard>

			<MapControlSectionCard
				collapsible
				collapseLabel={sectionCollapseLabel}
				expandLabel={sectionExpandLabel}
				id="help-planning-section"
				open={helpPanelPlanningOpen}
				title={t('planningHeading')}
				onOpenChange={setHelpPanelPlanningOpen}
			>
				<HelpList
					items={[
						['planner', t('planning.planner')],
						['tripBrief', t('planning.tripBrief')],
						['progress', t('planning.progress')],
						['journal', t('planning.journal')],
						['packWeight', t('planning.packWeight')],
						['resupply', t('planning.resupply')],
					]}
				/>
			</MapControlSectionCard>

			<MapControlSectionCard
				collapsible
				collapseLabel={sectionCollapseLabel}
				expandLabel={sectionExpandLabel}
				open={helpPanelOfflineOpen}
				title={t('offlineHeading')}
				onOpenChange={setHelpPanelOfflineOpen}
			>
				<HelpList
					items={[
						['precache', t('offline.precache')],
						['mobileDownload', t('offline.mobileDownload')],
						['cacheHealth', t('offline.cacheHealth')],
						['gps', t('offline.gps')],
						['offRouteAlert', t('offline.offRouteAlert')],
						['navTarget', t('offline.navTarget')],
						['firstAid', t('offline.firstAid')],
						['daylight', t('offline.daylight')],
						['pushAlerts', t('offline.pushAlerts')],
					]}
				/>
			</MapControlSectionCard>

			<MapControlSectionCard
				collapsible
				collapseLabel={sectionCollapseLabel}
				expandLabel={sectionExpandLabel}
				open={helpPanelDemoOpen}
				title={t('demoHeading')}
				onOpenChange={setHelpPanelDemoOpen}
			>
				<HelpList
					items={[
						[
							'demo',
							<>
								{t('demoDesc')}{' '}
								<Link className={INLINE_LINK_CLASS} href="/demo">
									{t('demoLink')}
								</Link>
							</>,
						],
					]}
				/>
			</MapControlSectionCard>

			<p className="m-0 border-t border-gray-200 pt-2 text-[0.6875rem] leading-snug text-gray-500 dark:border-[var(--border-color)] dark:text-[var(--text-secondary)]">
				{t('officialAppNote')}
			</p>
		</div>
	);
}
