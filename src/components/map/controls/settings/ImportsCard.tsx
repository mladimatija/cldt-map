'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { MapControlsImportsPanel } from '../MapControlsImportsPanel';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { useShallow } from 'zustand/react/shallow';

/** Imported GPX tracks. */
export function ImportsCard(): React.ReactElement {
	const t = useTranslations('mapControls');
	const { settingsPanelImportsOpen, setSettingsPanelImportsOpen } = useMapStore(
		useShallow((s: MapStoreState) => ({
			settingsPanelImportsOpen: s.settingsPanelImportsOpen,
			setSettingsPanelImportsOpen: s.setSettingsPanelImportsOpen,
		})),
	);
	return (
		<MapControlSectionCard
			collapsible
			id="settings-imports-section"
			open={settingsPanelImportsOpen}
			title={t('sections.imports')}
			onOpenChange={setSettingsPanelImportsOpen}
		>
			<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('sections.importsProgressHint')}</p>
			<MapControlsImportsPanel embedded />
		</MapControlSectionCard>
	);
}
