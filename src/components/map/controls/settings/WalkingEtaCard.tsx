'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { formatPace } from '@/lib/distance-utils';
import { PACE_FACTOR_DEFAULT, PACE_FACTOR_MAX, PACE_FACTOR_MIN } from '@/lib/pack-weight';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { IoRefreshOutline } from 'react-icons/io5';
import { MapControlSectionCard } from '../MapControlSectionCard';
import { MapControlIconButton } from '../MapControlIconButton';
import { SettingsToggleRow } from '../SettingsToggleRow';
import { useShallow } from 'zustand/react/shallow';

/** Walking pace and pace factor, grade-adjusted ETA, sunset projection and Up next. */
export function WalkingEtaCard(): React.ReactElement {
	const t = useTranslations('mapControls');
	const {
		units,
		walkingPaceKmh,
		setWalkingPaceKmh,
		paceFactor,
		setPaceFactor,
		gradeAdjustedEta,
		setGradeAdjustedEta,
		sunsetProjection,
		setSunsetProjection,
		showUpNext,
		setShowUpNext,
		upNextShowFood,
		setUpNextShowFood,
		upNextShowAtm,
		setUpNextShowAtm,
		upNextShowViewpoint,
		setUpNextShowViewpoint,
		upNextShowPharmacy,
		setUpNextShowPharmacy,
	} = useMapStore(
		useShallow((s: MapStoreState) => ({
			units: s.units,
			walkingPaceKmh: s.walkingPaceKmh,
			setWalkingPaceKmh: s.setWalkingPaceKmh,
			paceFactor: s.paceFactor,
			setPaceFactor: s.setPaceFactor,
			gradeAdjustedEta: s.gradeAdjustedEta,
			setGradeAdjustedEta: s.setGradeAdjustedEta,
			sunsetProjection: s.sunsetProjection,
			setSunsetProjection: s.setSunsetProjection,
			showUpNext: s.showUpNext,
			setShowUpNext: s.setShowUpNext,
			upNextShowFood: s.upNextShowFood,
			setUpNextShowFood: s.setUpNextShowFood,
			upNextShowAtm: s.upNextShowAtm,
			setUpNextShowAtm: s.setUpNextShowAtm,
			upNextShowViewpoint: s.upNextShowViewpoint,
			setUpNextShowViewpoint: s.setUpNextShowViewpoint,
			upNextShowPharmacy: s.upNextShowPharmacy,
			setUpNextShowPharmacy: s.setUpNextShowPharmacy,
		})),
	);
	return (
		<MapControlSectionCard title={t('sections.walkingEta')}>
			<div className="flex flex-col gap-1">
				<div className="flex items-center gap-2">
					<label className="text-sm text-gray-700 dark:text-[var(--text-primary)]" htmlFor="walking-pace-slider">
						{t('walkingPace')}
					</label>
					<span className="text-cldt-blue ml-auto shrink-0 text-sm font-semibold tabular-nums">
						{formatPace(walkingPaceKmh, units)}
					</span>
					{walkingPaceKmh !== 4 && (
						<MapControlIconButton
							aria-label={t('walkingPaceReset')}
							variant="mapControlOutlineSecondary"
							onClick={() => setWalkingPaceKmh(4)}
						>
							<IoRefreshOutline aria-hidden className="h-3.5 w-3.5" />
						</MapControlIconButton>
					)}
				</div>
				<input
					aria-valuetext={formatPace(walkingPaceKmh, units)}
					className="precision-slider w-full min-w-0"
					id="walking-pace-slider"
					max={10}
					min={1}
					step={0.1}
					type="range"
					value={walkingPaceKmh}
					onChange={(e) => setWalkingPaceKmh(Number(e.target.value))}
				/>
				<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
					{t('walkingPaceHint', {
						min: formatPace(1, units),
						max: formatPace(10, units),
						default: formatPace(4, units),
					})}
				</p>
			</div>

			<div className="flex flex-col gap-1">
				<div className="flex items-center gap-2">
					<label className="text-sm text-gray-700 dark:text-[var(--text-primary)]" htmlFor="pace-factor-slider">
						{t('paceFactor')}
					</label>
					<span className="text-cldt-blue ml-auto shrink-0 text-sm font-semibold tabular-nums">
						{`${Math.round(paceFactor * 100)}%`}
					</span>
					{paceFactor !== PACE_FACTOR_DEFAULT && (
						<MapControlIconButton
							aria-label={t('paceFactorReset')}
							variant="mapControlOutlineSecondary"
							onClick={() => setPaceFactor(PACE_FACTOR_DEFAULT)}
						>
							<IoRefreshOutline aria-hidden className="h-3.5 w-3.5" />
						</MapControlIconButton>
					)}
				</div>
				<input
					aria-valuetext={`${Math.round(paceFactor * 100)}%`}
					className="precision-slider w-full min-w-0"
					id="pace-factor-slider"
					max={PACE_FACTOR_MAX}
					min={PACE_FACTOR_MIN}
					step={0.05}
					type="range"
					value={paceFactor}
					onChange={(e) => setPaceFactor(Number(e.target.value))}
				/>
				<p className="m-0 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
					{t('paceFactorHint', {
						min: `${Math.round(PACE_FACTOR_MIN * 100)}%`,
						max: `${Math.round(PACE_FACTOR_MAX * 100)}%`,
					})}
				</p>
			</div>

			<SettingsToggleRow
				checked={gradeAdjustedEta}
				hint={t('gradeAdjustedEtaHint')}
				label={t('gradeAdjustedEtaLabel')}
				onCheckedChange={(checked) => setGradeAdjustedEta(checked)}
			/>
			<SettingsToggleRow
				checked={sunsetProjection}
				hint={t('sunsetProjectionHint')}
				label={t('sunsetProjectionLabel')}
				onCheckedChange={(checked) => setSunsetProjection(checked)}
			/>
			<SettingsToggleRow
				checked={showUpNext}
				hint={t('showUpNextHint')}
				label={t('showUpNextLabel')}
				onCheckedChange={(checked) => setShowUpNext(checked)}
			/>

			{showUpNext && (
				<div className="ml-6 flex flex-col gap-2">
					<SettingsToggleRow
						checked={upNextShowFood}
						label={t('upNextShowFoodLabel')}
						tooltip={t('upNextShowFoodHint')}
						onCheckedChange={(checked) => setUpNextShowFood(checked)}
					/>
					<SettingsToggleRow
						checked={upNextShowAtm}
						label={t('upNextShowAtmLabel')}
						tooltip={t('upNextShowAtmHint')}
						onCheckedChange={(checked) => setUpNextShowAtm(checked)}
					/>
					<SettingsToggleRow
						checked={upNextShowViewpoint}
						label={t('upNextShowViewpointLabel')}
						tooltip={t('upNextShowViewpointHint')}
						onCheckedChange={(checked) => setUpNextShowViewpoint(checked)}
					/>
					<SettingsToggleRow
						checked={upNextShowPharmacy}
						label={t('upNextShowPharmacyLabel')}
						tooltip={t('upNextShowPharmacyHint')}
						onCheckedChange={(checked) => setUpNextShowPharmacy(checked)}
					/>
				</div>
			)}
		</MapControlSectionCard>
	);
}
