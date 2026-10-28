'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { MapControlsTileCachePanel } from '../MapControlsTileCachePanel';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { useShallow } from 'zustand/react/shallow';

/** Offline tile downloads; open by default once a download exists. */
export function OfflineMapsCard(): React.ReactElement {
	const t = useTranslations('mapControls');
	const { settingsPanelOfflineOpen, setSettingsPanelOfflineOpen, tileCacheMeta } = useMapStore(
		useShallow((s: MapStoreState) => ({
			settingsPanelOfflineOpen: s.settingsPanelOfflineOpen,
			setSettingsPanelOfflineOpen: s.setSettingsPanelOfflineOpen,
			tileCacheMeta: s.tileCacheMeta,
		})),
	);
	const offlineSectionOpen = settingsPanelOfflineOpen ?? !!tileCacheMeta;

	return (
		<MapControlSectionCard
			collapsible
			id="settings-offline-section"
			open={offlineSectionOpen}
			title={t('sections.offlineMaps')}
			onOpenChange={(open) => setSettingsPanelOfflineOpen(open)}
		>
			<MapControlsTileCachePanel embedded />
		</MapControlSectionCard>
	);
}
