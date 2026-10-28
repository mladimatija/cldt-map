'use client';

import React, { useEffect, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { usePopoverFocusTrap } from '@/hooks';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { IoSettingsOutline } from 'react-icons/io5';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { MAP_CONTROL_PANEL_WIDTH, MAP_CONTROL_POPOVER } from '../map-controls-constants';
import { DisplayDeviceCard } from './DisplayDeviceCard';
import { TrailAppearanceCard } from './TrailAppearanceCard';
import { MapOverlaysCard } from './MapOverlaysCard';
import { WalkingEtaCard } from './WalkingEtaCard';
import { PackPaceCard } from './PackPaceCard';
import { NotificationsSharingCard } from './NotificationsSharingCard';
import { OfflineMapsCard } from './OfflineMapsCard';
import { ImportsCard } from './ImportsCard';

interface SettingsPanelProps {
	containerRef: RefObject<HTMLDivElement | null>;
	isExpanded: boolean;
	onToggle: () => void;
}

/** Settings popover: one card per group; each card reads only its own store fields. */
export function SettingsPanel({ containerRef, isExpanded, onToggle }: SettingsPanelProps): React.ReactElement {
	const t = useTranslations('mapControls');
	const popoverRef = usePopoverFocusTrap(isExpanded);
	const settingsScrollTarget = useMapStore((state: MapStoreState) => state.settingsScrollTarget);

	// A deep link to a section opens it and scrolls it into view.
	useEffect(() => {
		if (!isExpanded || !settingsScrollTarget) return;
		const store = useMapStore.getState();
		if (settingsScrollTarget === 'imports') store.setSettingsPanelImportsOpen(true);
		else if (settingsScrollTarget === 'overlays') store.setSettingsPanelOverlaysOpen(true);
		else if (settingsScrollTarget === 'offline') store.setSettingsPanelOfflineOpen(true);
		const el = document.getElementById(`settings-${settingsScrollTarget}-section`);
		el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		store.clearSettingsScrollTarget();
	}, [isExpanded, settingsScrollTarget]);

	return (
		<div className="relative inline-block w-10 shrink-0" data-tour="offline" ref={containerRef}>
			{isExpanded && (
				<div
					aria-labelledby="settings-panel-title"
					aria-modal="true"
					className={cn(
						MAP_CONTROL_POPOVER,
						`fixed top-2 right-16 flex max-h-[calc(100dvh-4rem)] ${MAP_CONTROL_PANEL_WIDTH} flex-col gap-2 overflow-hidden`,
					)}
					ref={popoverRef}
					role="dialog"
				>
					<h3
						className="shrink-0 text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]"
						id="settings-panel-title"
					>
						{t('preferences')}
					</h3>

					<div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
						<div className="flex flex-col gap-2">
							<DisplayDeviceCard />

							<TrailAppearanceCard />

							<MapOverlaysCard />

							<WalkingEtaCard />

							<PackPaceCard />

							<NotificationsSharingCard />

							<OfflineMapsCard />

							<ImportsCard />
						</div>
					</div>
				</div>
			)}
			<SmartTooltip content={isExpanded ? t('preferencesHide') : t('preferencesShow')} position="left">
				<Button
					aria-label={isExpanded ? t('preferencesHide') : t('preferencesShow')}
					variant={isExpanded ? 'controlRoundActive' : 'controlRound'}
					onClick={onToggle}
				>
					<IoSettingsOutline aria-hidden className="h-5 w-5" />
				</Button>
			</SmartTooltip>
		</div>
	);
}
