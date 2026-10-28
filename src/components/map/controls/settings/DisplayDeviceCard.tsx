'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { routing, type Locale } from '@/i18n/routing';
import { useClientLocale } from '@/components/providers/ClientIntlProvider';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { UI_TEXT_SCALES } from '@/lib/ui-text-scale';
import {
	IoLanguageOutline,
	IoMoonOutline,
	IoSunnyOutline,
	IoTrailSignOutline,
	IoLocateOutline,
	IoBatteryHalfOutline,
	IoCompassOutline,
	IoHandLeftOutline,
	IoTextOutline,
} from 'react-icons/io5';
import { requestCompassPermission } from '@/hooks/useCompassHeading';
import { Radio } from '@/components/ui/Radio';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { MapControlSingleSelect } from '../MapControlSelect';
import { SettingsToggleRow } from '../SettingsToggleRow';
import { useShallow } from 'zustand/react/shallow';

type LanguageOption = { value: Locale; label: string };

/** Language, theme, touch targets and text size, and the device behaviour toggles. */
export function DisplayDeviceCard(): React.ReactElement {
	const t = useTranslations('mapControls');
	const tFooter = useTranslations('footer');
	const {
		darkMode,
		setDarkMode,
		batterySaverMode,
		setBatterySaverMode,
		largeTouchTargets,
		setLargeTouchTargets,
		uiTextScale,
		setUiTextScale,
		compassEnabled,
		setCompassEnabled,
		liveTrackingEnabled,
		setLiveTrackingEnabled,
		keepScreenOn,
		setKeepScreenOn,
		offRouteAlertEnabled,
		setOffRouteAlertEnabled,
	} = useMapStore(
		useShallow((s: MapStoreState) => ({
			darkMode: s.darkMode,
			setDarkMode: s.setDarkMode,
			batterySaverMode: s.batterySaverMode,
			setBatterySaverMode: s.setBatterySaverMode,
			largeTouchTargets: s.largeTouchTargets,
			setLargeTouchTargets: s.setLargeTouchTargets,
			uiTextScale: s.uiTextScale,
			setUiTextScale: s.setUiTextScale,
			compassEnabled: s.compassEnabled,
			setCompassEnabled: s.setCompassEnabled,
			liveTrackingEnabled: s.liveTrackingEnabled,
			setLiveTrackingEnabled: s.setLiveTrackingEnabled,
			keepScreenOn: s.keepScreenOn,
			setKeepScreenOn: s.setKeepScreenOn,
			offRouteAlertEnabled: s.offRouteAlertEnabled,
			setOffRouteAlertEnabled: s.setOffRouteAlertEnabled,
		})),
	);
	const activeLocale = useLocale() as Locale;
	const { setLocale } = useClientLocale();

	const handleCompassToggle = async (checked: boolean): Promise<void> => {
		if (!checked) {
			setCompassEnabled(false);
			return;
		}
		const granted = await requestCompassPermission();
		setCompassEnabled(granted);
	};

	const languageSelectWrapRef = useRef<HTMLDivElement>(null);
	const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
	const languageOptions = useMemo<LanguageOption[]>(
		() => routing.locales.map((loc) => ({ value: loc, label: tFooter(loc) })),
		[tFooter],
	);
	const selectedLanguage = useMemo(
		() => languageOptions.find((o) => o.value === activeLocale) ?? null,
		[languageOptions, activeLocale],
	);
	// Applies in place, like the footer switcher: a navigation would change the
	// [locale] segment and remount the page, map included.
	const handleLanguageChange = useCallback(
		(opt: LanguageOption | null): void => {
			if (!opt) return;
			setLocale(opt.value);
			setLanguageMenuOpen(false);
		},
		[setLocale],
	);
	// Leaflet's disableClickPropagation on this panel swallows the control's
	// pointerdown before react-select sees it, so toggle the menu natively and
	// portal it to document.body so the options stay clickable outside the
	// panel's overflow/stacking. The panel's outside-click close ignores the
	// portalled menu - see usePanelListeners.
	useEffect(() => {
		const wrap = languageSelectWrapRef.current;
		if (!wrap) return;
		const onControlPointerDown = (e: MouseEvent | TouchEvent): void => {
			if (!(e.target as Element).closest('.map-control-select__control')) return;
			e.stopPropagation();
			setLanguageMenuOpen((open) => !open);
		};
		wrap.addEventListener('mousedown', onControlPointerDown);
		wrap.addEventListener('touchstart', onControlPointerDown, { passive: true });
		return () => {
			wrap.removeEventListener('mousedown', onControlPointerDown);
			wrap.removeEventListener('touchstart', onControlPointerDown);
		};
	}, []);

	return (
		<MapControlSectionCard title={t('sections.displayDevice')}>
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<IoLanguageOutline aria-hidden className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
					<span className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]">
						{tFooter('language')}
					</span>
				</div>
				<div ref={languageSelectWrapRef}>
					<MapControlSingleSelect<LanguageOption>
						aria-label={tFooter('language')}
						instanceId="settings-language"
						menuIsOpen={languageMenuOpen}
						menuPortalTarget={typeof document === 'undefined' ? null : document.body}
						options={languageOptions}
						value={selectedLanguage}
						onChange={handleLanguageChange}
						onMenuClose={() => setLanguageMenuOpen(false)}
						onMenuOpen={() => setLanguageMenuOpen(true)}
					/>
				</div>
			</div>
			<SettingsToggleRow
				checked={darkMode}
				icon={<IoMoonOutline className="h-4 w-4" />}
				label={t('darkMode')}
				onCheckedChange={(checked) => setDarkMode(checked)}
			/>
			<SettingsToggleRow
				checked={batterySaverMode}
				icon={<IoBatteryHalfOutline className="h-4 w-4" />}
				label={t('batterySaver')}
				tooltip={t('batterySaverTooltip')}
				onCheckedChange={(checked) => setBatterySaverMode(checked)}
			/>
			<SettingsToggleRow
				checked={largeTouchTargets}
				icon={<IoHandLeftOutline className="h-4 w-4" />}
				label={t('largeTouchTargets')}
				tooltip={t('largeTouchTargetsTooltip')}
				onCheckedChange={(checked) => setLargeTouchTargets(checked)}
			/>
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<IoTextOutline aria-hidden className="h-4 w-4 shrink-0 text-gray-600 dark:text-white" />
					<span className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]">{t('textSize')}</span>
				</div>
				<div className="grid grid-cols-3 gap-1.5">
					{UI_TEXT_SCALES.map((scale) => (
						<label className="flex cursor-pointer items-center gap-2" key={scale}>
							<Radio
								checked={uiTextScale === scale}
								name="ui-text-scale"
								value={scale}
								onChange={() => setUiTextScale(scale)}
							/>
							<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">
								{t(`textSizeOption.${scale}`)}
							</span>
						</label>
					))}
				</div>
				<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('textSizeTooltip')}</p>
			</div>
			<SettingsToggleRow
				checked={liveTrackingEnabled}
				icon={<IoLocateOutline className="h-4 w-4" />}
				label={t('liveTracking')}
				tooltip={t('liveTrackingTooltip')}
				onCheckedChange={(checked) => setLiveTrackingEnabled(checked)}
			/>
			<SettingsToggleRow
				checked={compassEnabled}
				icon={<IoCompassOutline className="h-4 w-4" />}
				label={t('compassHeading')}
				tooltip={t('compassHeadingTooltip')}
				onCheckedChange={(checked) => void handleCompassToggle(checked)}
			/>
			<SettingsToggleRow
				checked={keepScreenOn}
				icon={<IoSunnyOutline className="h-4 w-4" />}
				label={t('keepScreenOn')}
				tooltip={t('keepScreenOnTooltip')}
				onCheckedChange={(checked) => setKeepScreenOn(checked)}
			/>
			<SettingsToggleRow
				checked={offRouteAlertEnabled}
				icon={<IoTrailSignOutline className="h-4 w-4" />}
				label={t('offRouteAlert')}
				tooltip={t('offRouteAlertTooltip')}
				onCheckedChange={(checked) => setOffRouteAlertEnabled(checked)}
			/>
		</MapControlSectionCard>
	);
}
