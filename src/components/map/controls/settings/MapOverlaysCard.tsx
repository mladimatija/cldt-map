'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { IoTrailSignOutline, IoAlertCircleOutline, IoWarningOutline, IoSnowOutline } from 'react-icons/io5';
import { severityColor, type SeasonalSeverity } from '@/lib/seasonal-status';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { SettingsToggleRow } from '../SettingsToggleRow';
import { useShallow } from 'zustand/react/shallow';
import { LEGEND_PANEL } from './settings-styles';

/** Severe weather, mine areas, connecting trails, seasonal status and Waymarked Trails layers. */
export function MapOverlaysCard(): React.ReactElement {
	const t = useTranslations('mapControls');
	const tWeather = useTranslations('severeWeather');
	const tMineAreas = useTranslations('mineAreas');
	const tTrailJunctions = useTranslations('trailJunctions');
	const tSeasonal = useTranslations('seasonalStatus');
	const {
		settingsPanelOverlaysOpen,
		setSettingsPanelOverlaysOpen,
		severeWeatherLayer,
		setSevereWeatherLayer,
		mineAreasFile,
		mineAreasEnabled,
		setMineAreasEnabled,
		trailJunctionsFile,
		showTrailJunctions,
		setShowTrailJunctions,
		seasonalStatusFile,
		seasonalStatusLayerEnabled,
		setSeasonalStatusLayerEnabled,
		waymarkedTrailsOverlay,
		setWaymarkedTrailsOverlay,
	} = useMapStore(
		useShallow((s: MapStoreState) => ({
			settingsPanelOverlaysOpen: s.settingsPanelOverlaysOpen,
			setSettingsPanelOverlaysOpen: s.setSettingsPanelOverlaysOpen,
			severeWeatherLayer: s.severeWeatherLayer,
			setSevereWeatherLayer: s.setSevereWeatherLayer,
			mineAreasFile: s.mineAreasFile,
			mineAreasEnabled: s.mineAreasEnabled,
			setMineAreasEnabled: s.setMineAreasEnabled,
			trailJunctionsFile: s.trailJunctionsFile,
			showTrailJunctions: s.showTrailJunctions,
			setShowTrailJunctions: s.setShowTrailJunctions,
			seasonalStatusFile: s.seasonalStatusFile,
			seasonalStatusLayerEnabled: s.seasonalStatusLayerEnabled,
			setSeasonalStatusLayerEnabled: s.setSeasonalStatusLayerEnabled,
			waymarkedTrailsOverlay: s.waymarkedTrailsOverlay,
			setWaymarkedTrailsOverlay: s.setWaymarkedTrailsOverlay,
		})),
	);
	const [nowMs] = useState(() => Date.now());
	const seasonalLastUpdatedDays: number | null = ((): number | null => {
		if (!seasonalStatusFile?.lastUpdated) return null;
		const ts = Date.parse(seasonalStatusFile.lastUpdated);
		if (Number.isNaN(ts)) return null;
		return Math.max(0, Math.round((nowMs - ts) / 86_400_000));
	})();

	return (
		<MapControlSectionCard
			collapsible
			id="settings-overlays-section"
			open={settingsPanelOverlaysOpen}
			title={t('sections.mapOverlays')}
			onOpenChange={setSettingsPanelOverlaysOpen}
		>
			<SettingsToggleRow
				checked={severeWeatherLayer}
				icon={<IoWarningOutline className="h-4 w-4" />}
				label={tWeather('layerLabel')}
				tooltip={tWeather('layerTooltip')}
				onCheckedChange={(checked) => setSevereWeatherLayer(checked)}
			/>

			{mineAreasFile && mineAreasFile.areas.length > 0 && (
				<SettingsToggleRow
					checked={mineAreasEnabled}
					icon={<IoAlertCircleOutline className="h-4 w-4" />}
					label={tMineAreas('layerLabel')}
					tooltip={tMineAreas('layerTooltip')}
					onCheckedChange={(checked) => setMineAreasEnabled(checked)}
				/>
			)}

			{trailJunctionsFile && trailJunctionsFile.junctions.length > 0 && (
				<SettingsToggleRow
					checked={showTrailJunctions}
					icon={<IoTrailSignOutline className="h-4 w-4" />}
					label={tTrailJunctions('layerLabel')}
					tooltip={tTrailJunctions('layerTooltip')}
					onCheckedChange={(checked) => setShowTrailJunctions(checked)}
				/>
			)}

			{seasonalStatusFile && (
				<SettingsToggleRow
					checked={seasonalStatusLayerEnabled}
					icon={<IoSnowOutline className="h-4 w-4" />}
					label={tSeasonal('layerToggle')}
					tooltip={tSeasonal('layerTooltip')}
					onCheckedChange={(checked) => setSeasonalStatusLayerEnabled(checked)}
				/>
			)}
			{seasonalStatusFile && seasonalStatusLayerEnabled && (
				<div className={LEGEND_PANEL}>
					{(['open', 'caution', 'closed_recommended', 'experts_only'] as SeasonalSeverity[]).map((sev) => (
						<div className="flex items-center gap-2" key={sev}>
							<span
								aria-hidden="true"
								className="inline-block h-3 w-4 shrink-0 rounded-sm"
								style={{ backgroundColor: severityColor(sev) }}
							/>
							<span>{tSeasonal(`severity.${sev}`)}</span>
						</div>
					))}
					{seasonalLastUpdatedDays !== null && (
						<p className="mt-1 mb-0 text-xs italic opacity-75">
							{tSeasonal('lastUpdatedDaysAgo', { days: seasonalLastUpdatedDays })}
						</p>
					)}
				</div>
			)}

			<SettingsToggleRow
				checked={waymarkedTrailsOverlay}
				hint={t('waymarkedHint')}
				label={t('waymarkedLabel')}
				onCheckedChange={(checked) => setWaymarkedTrailsOverlay(checked)}
			/>
		</MapControlSectionCard>
	);
}
