'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { type Locale } from '@/i18n/routing';
import { disablePushAlerts, enablePushAlerts, pushAlertsSupported } from '@/lib/push-alerts';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { SettingsToggleRow } from '../SettingsToggleRow';
import { useShallow } from 'zustand/react/shallow';

/** Push alerts and short share links. */
export function NotificationsSharingCard(): React.ReactElement {
	const t = useTranslations('mapControls');
	const {
		settingsPanelNotificationsOpen,
		setSettingsPanelNotificationsOpen,
		pushAlertsEnabled,
		setPushAlertsEnabled,
		shareShortLinks,
		setShareShortLinks,
	} = useMapStore(
		useShallow((s: MapStoreState) => ({
			settingsPanelNotificationsOpen: s.settingsPanelNotificationsOpen,
			setSettingsPanelNotificationsOpen: s.setSettingsPanelNotificationsOpen,
			pushAlertsEnabled: s.pushAlertsEnabled,
			setPushAlertsEnabled: s.setPushAlertsEnabled,
			shareShortLinks: s.shareShortLinks,
			setShareShortLinks: s.setShareShortLinks,
		})),
	);
	const activeLocale = useLocale() as Locale;

	const handlePushAlertsToggle = async (checked: boolean): Promise<void> => {
		if (!checked) {
			setPushAlertsEnabled(false);
			void disablePushAlerts();
			return;
		}
		setPushAlertsEnabled(await enablePushAlerts(activeLocale));
	};

	return (
		<MapControlSectionCard
			collapsible
			open={settingsPanelNotificationsOpen}
			title={t('sections.notificationsSharing')}
			onOpenChange={setSettingsPanelNotificationsOpen}
		>
			{pushAlertsSupported() && (
				<SettingsToggleRow
					checked={pushAlertsEnabled}
					hint={t('pushAlertsHint')}
					label={t('pushAlertsLabel')}
					onCheckedChange={(checked) => void handlePushAlertsToggle(checked)}
				/>
			)}
			<SettingsToggleRow
				checked={shareShortLinks}
				hint={t('shareShortLinksHint')}
				label={t('shareShortLinksLabel')}
				onCheckedChange={(checked) => setShareShortLinks(checked)}
			/>
		</MapControlSectionCard>
	);
}
