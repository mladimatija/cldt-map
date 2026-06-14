'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useLocale, useMessages, useTranslations } from 'next-intl';
import { useMap } from 'react-leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { Button } from '@/components/ui/Button';
import { Radio } from '@/components/ui/Radio';
import { Checkbox } from '@/components/ui/Checkbox';
import { applyAiNarratives, fetchAiNarratives } from '@/lib/trip-brief-ai';
import { cn } from '@/lib/utils';
import {
	applyNarrativeEdits,
	assembleTripBrief,
	canAssembleTripBrief,
	makeDistanceLabelFn,
	type TripBrief,
} from '@/lib/trip-brief';
import { dayHeader, tripBriefStringsFromMessages } from '@/lib/trip-brief-i18n';
import { exportTripBriefPdf } from '@/lib/trip-brief-pdf';
import { exportTripBriefDocx } from '@/lib/trip-brief-docx';
import { exportTripBriefHtml } from '@/lib/trip-brief-html';
import { useActiveStarredPoiIds, usePackAdjustedPaceKmh } from '@/hooks';
import { computeStagePackScenarios, formatVolume, formatWeight, kgToDisplay, weightUnitLabel } from '@/lib/pack-weight';
import { buildResupplyCadenceLabels, type StageResupplyCadence } from '@/lib/resupply-cadence';
import { poiDisplayName } from '@/lib/pois';
import { missingGearTerms } from '@/lib/pack-csv';
import { renderElevationThumbnail } from '@/lib/elevation-thumbnail';
import { Locale } from '@/i18n/routing';
import { MAP_CONTROL_INPUT } from './map-controls-constants';
import { MapControlModalShell } from './MapControlModalShell';

interface MapControlsTripBriefModalProps {
	open: boolean;
	onClose: () => void;
}

type Format = 'pdf' | 'docx' | 'html';
type PoiScope = 'selected' | 'allInStage';
type Step = 'options' | 'edit';

const NARRATIVE_TEXTAREA = cn(
	MAP_CONTROL_INPUT,
	'min-h-[4.5rem] w-full resize-y text-sm dark:border-[var(--border-color)]',
);

/**
 * Modal that lets the user pick export options, review and edit narratives,
 * then generate the trip brief (PDF/DOCX/HTML). Reads stage plan + POI
 * selection + seasonal status from the store. The AI narrative toggle asks
 * /api/narrative for guide-style day paragraphs (best-effort: templated
 * text remains the fallback, and exports never fail because of it).
 *
 * Export-option selections (format, POI scope, AI-narrative toggle) are
 * remembered across close/reopen while the modal stays mounted; the prepared
 * brief and its edit buffers are dropped on close (see resetModalState).
 */
export function MapControlsTripBriefModal({
	open,
	onClose,
}: MapControlsTripBriefModalProps): React.ReactElement | null {
	const t = useTranslations('tripBrief');
	const tPois = useTranslations('pois');
	const locale = useLocale();
	const messages = useMessages();
	const map = useMap();
	const trailTitle = t('defaultTitle');

	const stagePlan = useMapStore((s: MapStoreState) => s.stagePlan);
	const poisFile = useMapStore((s: MapStoreState) => s.poisFile);
	const activeStarredPoiIds = useActiveStarredPoiIds();
	const enabledPoiTypes = useMapStore((s: MapStoreState) => s.enabledPoiTypes);
	const enabledPoiTags = useMapStore((s: MapStoreState) => s.enabledPoiTags);
	const includeRemotePois = useMapStore((s: MapStoreState) => s.includeRemotePois);
	const walkingPaceKmh = usePackAdjustedPaceKmh();
	const packBaseWeightKg = useMapStore((s: MapStoreState) => s.packBaseWeightKg);
	const waterConsumptionLph = useMapStore((s: MapStoreState) => s.waterConsumptionLph);
	const foodConsumptionKgPerDay = useMapStore((s: MapStoreState) => s.foodConsumptionKgPerDay);
	const packGearList = useMapStore((s: MapStoreState) => s.packGearList);
	const gradeAdjustedEta = useMapStore((s: MapStoreState) => s.gradeAdjustedEta);
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);
	const direction = useMapStore((s: MapStoreState) => s.direction);
	const seasonalEntries = useMapStore((s: MapStoreState) => s.seasonalStatusEntries);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);

	const [step, setStep] = useState<Step>('options');
	const [format, setFormat] = useState<Format>('pdf');
	const [poiScope, setPoiScope] = useState<PoiScope>('allInStage');
	const [aiNarrative, setAiNarrative] = useState(false);
	const [preparedBrief, setPreparedBrief] = useState<TripBrief | null>(null);
	const [editOverview, setEditOverview] = useState('');
	const [editDayNarratives, setEditDayNarratives] = useState<string[]>([]);
	const [aiPhase, setAiPhase] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const enabled = useMemo(
		() => canAssembleTripBrief(stagePlan, enhancedTrailPoints.length > 0),
		[stagePlan, enhancedTrailPoints],
	);

	/** Exporter strings for the active locale, from messages tripBrief.document.
	 *  Resolved here because the PDF/DOCX generators run outside React. */
	const documentStrings = useMemo(
		() => tripBriefStringsFromMessages((messages as { tripBrief?: { document?: unknown } }).tripBrief?.document),
		[messages],
	);

	const attachElevationThumbs = useCallback(
		(brief: TripBrief): TripBrief => ({
			...brief,
			days: brief.days.map((day) => {
				const thumb = renderElevationThumbnail(enhancedTrailPoints, day.startKm, day.endKm, direction === 'NOBO');
				return thumb ? { ...day, elevationThumb: thumb } : day;
			}),
		}),
		[enhancedTrailPoints, direction],
	);

	const assembleFromStore = useCallback((): TripBrief => {
		if (!stagePlan) {
			throw new Error('Stage plan required');
		}

		const poiName = (id: string): string => {
			const poi = poisFile?.pois.find((p) => p.id === id);
			return poi ? poiDisplayName(poi, locale) : id;
		};

		return assembleTripBrief({
			stagePlan,
			poisFile,
			enhancedTrailPoints,
			elevationPoints: enhancedTrailPoints,
			selectedPoiIds: activeStarredPoiIds,
			includeAllInStage: poiScope === 'allInStage',
			enabledPoiTypes,
			enabledPoiTags,
			includeRemotePois,
			walkingPaceKmh,
			gradeAdjustedEta,
			units,
			direction,
			locale: locale as Locale,
			title: trailTitle,
			seasonalEntries,
			typeLabel: (type) => tPois(`type.${type}`, { default: type }),
			distanceLabel: makeDistanceLabelFn(units, distancePrecision),
			strings: documentStrings,
			...(packGearList && {
				gearChecklist: ((): NonNullable<TripBrief['meta']['gearChecklist']> => {
					const gearStrings = seasonalEntries
						.map((entry) => entry.gear)
						.filter((g): g is string => typeof g === 'string' && g.trim().length > 0);
					const missing = missingGearTerms(gearStrings, packGearList);
					return {
						heading: t('gearHeading', { name: packGearList.sourceName }),
						...(missing.length > 0 && { missingLine: t('gearMissing', { terms: missing.join(', ') }) }),
						categories: packGearList.categories.map((cat) => ({
							name: `${cat.name} (${formatWeight(cat.kg, units)})`,
							lines: packGearList.items
								.filter((item) => item.category === cat.name)
								.map(
									(item) =>
										`${item.name}${item.qty > 1 ? ` x${item.qty}` : ''} - ${formatWeight(item.kg * item.qty, units)}`,
								),
						})),
					};
				})(),
			}),
			...(packBaseWeightKg !== null && {
				packSummary: t('packSummary', { base: formatWeight(packBaseWeightKg, units) }),
				packScenarioLabels: (dryStretchKm: number): { base: string; loaded?: string } | undefined => {
					const scenarios = computeStagePackScenarios(
						packBaseWeightKg,
						dryStretchKm,
						walkingPaceKmh,
						waterConsumptionLph,
					);
					const base = t('packBaseLine', { weight: formatWeight(scenarios.baseKg, units) });
					if (scenarios.carryLiters <= 0) return { base };
					return {
						base,
						loaded: t('packLoadedLine', {
							weight: formatWeight(scenarios.loadedKg, units),
							volume: formatVolume(scenarios.carryLiters, units),
						}),
					};
				},
			}),
			poiName,
			resupplyCadenceLabels: (cadence: StageResupplyCadence) =>
				buildResupplyCadenceLabels(cadence, {
					formatKm: makeDistanceLabelFn(units, distancePrecision),
					resolveTownName: poiName,
					consumableKg: packGearList?.consumableKg ?? 0,
					foodConsumptionKgPerDay,
					rateLabel: `${Math.round(kgToDisplay(foodConsumptionKgPerDay, units) * 10) / 10} ${weightUnitLabel(units)}/day`,
					entering: (v) => t('resupplyEntering', v),
					carry: (v) => t('resupplyCarry', v),
					foodPack: (v) => t('resupplyFoodPack', v),
				}),
			resupplySummaryLabel: ({ maxFoodGapKm, nextTown, nextDistanceKm }) => {
				const gapLine = t('resupplySummaryGap', {
					distance: makeDistanceLabelFn(units, distancePrecision)(maxFoodGapKm),
				});
				if (nextTown && nextDistanceKm !== undefined) {
					return `${gapLine} ${t('resupplySummaryNext', {
						town: nextTown,
						distance: makeDistanceLabelFn(units, distancePrecision)(nextDistanceKm),
					})}`;
				}
				return gapLine;
			},
		});
	}, [
		stagePlan,
		poisFile,
		enhancedTrailPoints,
		activeStarredPoiIds,
		poiScope,
		enabledPoiTypes,
		enabledPoiTags,
		includeRemotePois,
		walkingPaceKmh,
		gradeAdjustedEta,
		units,
		direction,
		locale,
		trailTitle,
		seasonalEntries,
		tPois,
		distancePrecision,
		documentStrings,
		packGearList,
		t,
		packBaseWeightKg,
		waterConsumptionLph,
		foodConsumptionKgPerDay,
	]);

	const resetModalState = useCallback((): void => {
		setStep('options');
		setPreparedBrief(null);
		setEditOverview('');
		setEditDayNarratives([]);
		setExportError(null);
		setGenerating(false);
		setAiPhase(false);
		setProgress(null);
	}, []);

	const handleContinue = async (): Promise<void> => {
		if (!stagePlan) return;
		const controller = new AbortController();
		abortRef.current = controller;
		setGenerating(true);
		setExportError(null);
		try {
			let brief = attachElevationThumbs(assembleFromStore());

			if (aiNarrative) {
				setAiPhase(true);
				const ai = await fetchAiNarratives(brief, controller.signal);
				setAiPhase(false);
				if (ai) {
					brief = applyAiNarratives(brief, ai, t('aiDisclaimer'));
				} else if (!controller.signal.aborted) {
					console.warn('AI narrative unavailable; using templated text.');
				}
			}

			if (controller.signal.aborted) return;

			setPreparedBrief(brief);
			setEditOverview(brief.overview.narrative);
			setEditDayNarratives(brief.days.map((day) => day.narrative));
			setStep('edit');
		} catch (err) {
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				console.error('Trip brief preparation failed:', err);
				setExportError(t('exportError'));
			}
		} finally {
			setGenerating(false);
			setAiPhase(false);
			abortRef.current = null;
		}
	};

	const handleBack = (): void => {
		setStep('options');
		setPreparedBrief(null);
		setEditOverview('');
		setEditDayNarratives([]);
		setExportError(null);
	};

	const handleExport = async (): Promise<void> => {
		if (!preparedBrief) return;
		const controller = new AbortController();
		abortRef.current = controller;
		setGenerating(true);
		setProgress(null);
		setExportError(null);
		try {
			const brief = applyNarrativeEdits(preparedBrief, {
				overview: editOverview,
				days: editDayNarratives,
			});

			const onProgress = (current: number, total: number): void => setProgress({ current, total });
			if (format === 'pdf') {
				await exportTripBriefPdf({
					brief,
					enhancedTrailPoints,
					map,
					onProgress,
					signal: controller.signal,
				});
			} else if (format === 'docx') {
				await exportTripBriefDocx({
					brief,
					enhancedTrailPoints,
					map,
					onProgress,
					signal: controller.signal,
				});
			} else {
				await exportTripBriefHtml({
					brief,
					onProgress,
					signal: controller.signal,
				});
			}
			resetModalState();
			onClose();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				console.error('Trip brief generation failed:', msg);
				setExportError(t('exportError'));
			}
		} finally {
			setGenerating(false);
			setProgress(null);
			abortRef.current = null;
		}
	};

	const handleCancel = useCallback((): void => {
		abortRef.current?.abort();
		resetModalState();
		onClose();
	}, [onClose, resetModalState]);

	if (!open) return null;

	const isEditStep = step === 'edit';

	return (
		<MapControlModalShell
			cardClassName={cn(isEditStep ? 'max-h-[85vh] max-w-md' : 'max-w-sm')}
			closeLabel={generating ? t('cancel') : t('close')}
			open={open}
			title={isEditStep ? t('editTitle') : t('title')}
			titleClassName="text-cldt-blue mb-2 text-base font-semibold dark:text-[var(--text-primary)]"
			titleId="trip-brief-title"
			onClose={handleCancel}
		>
			{isEditStep ? (
				<>
					<p className="mb-3 text-xs text-gray-600 dark:text-[var(--text-secondary)]">{t('editDescription')}</p>

					{preparedBrief?.meta.aiDisclaimer && (
						<p className="mb-3 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
							{preparedBrief.meta.aiDisclaimer}
						</p>
					)}

					<label className="mb-3 block">
						<span className="mb-1 block text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
							{t('document.labels.overview')}
						</span>
						<textarea
							className={NARRATIVE_TEXTAREA}
							disabled={generating}
							rows={4}
							value={editOverview}
							onChange={(e) => setEditOverview(e.target.value)}
						/>
					</label>

					{preparedBrief?.days.map((day, i) => (
						<label className="mb-3 block" key={day.index}>
							<span className="mb-1 block text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
								{dayHeader(day, documentStrings, preparedBrief.meta.units)}
							</span>
							{[day.resupplyEnteringLabel, day.resupplyCarryLabel, day.foodPackLabel]
								.filter((line): line is string => !!line)
								.map((line) => (
									<p className="mb-1 text-[10px] text-amber-700 dark:text-amber-400" key={line}>
										{line}
									</p>
								))}
							<textarea
								className={NARRATIVE_TEXTAREA}
								disabled={generating}
								rows={4}
								value={editDayNarratives[i] ?? ''}
								onChange={(e) => {
									const next = [...editDayNarratives];
									next[i] = e.target.value;
									setEditDayNarratives(next);
								}}
							/>
						</label>
					))}
				</>
			) : (
				<>
					<p className="mb-3 text-xs text-gray-600 dark:text-[var(--text-secondary)]">{t('description')}</p>

					{!enabled && <p className="mb-2 text-xs text-amber-700 italic dark:text-amber-300">{t('needsPlan')}</p>}

					<fieldset className="mb-3 flex flex-col gap-1">
						<legend className="text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
							{t('format')}
						</legend>
						<label className="flex items-center gap-2 text-sm text-gray-700 dark:text-[var(--text-primary)]">
							<Radio
								checked={format === 'pdf'}
								name="trip-brief-format"
								value="pdf"
								onChange={() => setFormat('pdf')}
							/>
							{t('pdf')}
						</label>
						<label className="flex items-center gap-2 text-sm text-gray-700 dark:text-[var(--text-primary)]">
							<Radio
								checked={format === 'docx'}
								name="trip-brief-format"
								value="docx"
								onChange={() => setFormat('docx')}
							/>
							{t('docx')}
						</label>
						<label className="flex items-center gap-2 text-sm text-gray-700 dark:text-[var(--text-primary)]">
							<Radio
								checked={format === 'html'}
								name="trip-brief-format"
								value="html"
								onChange={() => setFormat('html')}
							/>
							{t('html')}
						</label>
					</fieldset>

					<fieldset className="mb-3 flex flex-col gap-1">
						<legend className="text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
							{t('poiScope')}
						</legend>
						<label className="flex items-center gap-2 text-sm text-gray-700 dark:text-[var(--text-primary)]">
							<Radio
								checked={poiScope === 'allInStage'}
								name="trip-brief-pois"
								value="allInStage"
								onChange={() => setPoiScope('allInStage')}
							/>
							{t('poisAll')}
						</label>
						<label
							className={cn(
								'flex items-center gap-2 text-sm',
								activeStarredPoiIds.size > 0
									? 'cursor-pointer text-gray-700 dark:text-[var(--text-primary)]'
									: 'cursor-not-allowed text-gray-400 dark:text-[var(--text-secondary)]',
							)}
							title={activeStarredPoiIds.size > 0 ? undefined : t('poisSelectedComingSoon')}
						>
							<Radio
								checked={poiScope === 'selected'}
								disabled={activeStarredPoiIds.size === 0}
								name="trip-brief-pois"
								value="selected"
								onChange={() => setPoiScope('selected')}
							/>
							<span className={activeStarredPoiIds.size === 0 ? 'line-through' : undefined}>
								{t('poisSelected')}
								{activeStarredPoiIds.size > 0 && (
									<span className="ml-1 text-xs text-amber-600 dark:text-amber-400">({activeStarredPoiIds.size})</span>
								)}
							</span>
						</label>
					</fieldset>

					<label
						className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-[var(--text-primary)]"
						title={t('aiTooltip')}
					>
						<Checkbox checked={aiNarrative} onCheckedChange={(checked) => setAiNarrative(checked)} />
						{t('aiNarrative')}
					</label>

					{aiNarrative && (
						<p className="-mt-2 mb-3 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('aiDisclaimer')}</p>
					)}
				</>
			)}

			{generating && aiPhase && (
				<p className="mb-2 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('aiGenerating')}</p>
			)}

			{generating && !aiPhase && step === 'options' && (
				<p className="mb-2 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('preparing')}</p>
			)}

			{generating && progress && (
				<p className="mb-2 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
					{t('progress', { current: progress.current, total: progress.total })}
				</p>
			)}

			{exportError && (
				<p className="mb-2 text-xs text-red-600 dark:text-red-400" role="alert">
					{exportError}
				</p>
			)}

			<div className="flex justify-end gap-2">
				{isEditStep && (
					<Button disabled={generating} size="sm" variant="mapControlOutlineSecondary" onClick={handleBack}>
						{t('back')}
					</Button>
				)}
				<Button size="sm" variant="mapControlOutlineSecondary" onClick={handleCancel}>
					{generating ? t('cancel') : t('close')}
				</Button>
				{isEditStep ? (
					<Button
						disabled={generating || !preparedBrief}
						size="sm"
						variant="mapControlOutline"
						onClick={() => void handleExport()}
					>
						{generating ? t('generating') : t('generate')}
					</Button>
				) : (
					<Button
						disabled={!enabled || generating}
						size="sm"
						variant="mapControlOutline"
						onClick={() => void handleContinue()}
					>
						{generating ? t('preparing') : t('continue')}
					</Button>
				)}
			</div>
		</MapControlModalShell>
	);
}
