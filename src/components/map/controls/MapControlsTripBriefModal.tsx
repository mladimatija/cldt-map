'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useMessages, useTranslations } from 'next-intl';
import { useMap } from 'react-leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { Button } from '@/components/ui/Button';
import { Radio } from '@/components/ui/Radio';
import { Checkbox } from '@/components/ui/Checkbox';
import { applyAiNarratives, fetchAiNarratives } from '@/lib/trip-brief-ai';
import { cn } from '@/lib/utils';
import { assembleTripBrief, canAssembleTripBrief, makeDistanceLabelFn, type TripBrief } from '@/lib/trip-brief';
import { tripBriefStringsFromMessages } from '@/lib/trip-brief-i18n';
import { exportTripBriefPdf } from '@/lib/trip-brief-pdf';
import { exportTripBriefDocx } from '@/lib/trip-brief-docx';
import { usePopoverFocusTrap, usePackAdjustedPaceKmh } from '@/hooks';
import { formatVolume, formatWeight, packTotalKg, waterCarryLiters } from '@/lib/pack-weight';
import { missingGearTerms } from '@/lib/pack-csv';
import { renderElevationThumbnail } from '@/lib/elevation-thumbnail';
import { Locale } from '@/i18n/routing';

interface MapControlsTripBriefModalProps {
	open: boolean;
	onClose: () => void;
}

type Format = 'pdf' | 'docx';
type PoiScope = 'selected' | 'allInStage';

/**
 * Modal that lets the user pick the format (PDF/DOCX), which POIs to
 * include, and kicks off the trip-brief export. Reads stage plan + POI
 * selection + seasonal status from the store. The AI narrative toggle asks
 * /api/narrative for guide-style day paragraphs (best-effort: templated
 * text remains the fallback, and exports never fail because of it).
 *
 * Selection state is persisted only inside the modal; closing without
 * generating drops it.
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
	const starredPoiIds = useMapStore((s: MapStoreState) => s.starredPoiIds);
	const enabledPoiTypes = useMapStore((s: MapStoreState) => s.enabledPoiTypes);
	const enabledPoiTags = useMapStore((s: MapStoreState) => s.enabledPoiTags);
	const includeRemotePois = useMapStore((s: MapStoreState) => s.includeRemotePois);
	const walkingPaceKmh = usePackAdjustedPaceKmh();
	const packBaseWeightKg = useMapStore((s: MapStoreState) => s.packBaseWeightKg);
	const waterConsumptionLph = useMapStore((s: MapStoreState) => s.waterConsumptionLph);
	const packGearList = useMapStore((s: MapStoreState) => s.packGearList);
	const gradeAdjustedEta = useMapStore((s: MapStoreState) => s.gradeAdjustedEta);
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);
	const direction = useMapStore((s: MapStoreState) => s.direction);
	const seasonalEntries = useMapStore((s: MapStoreState) => s.seasonalStatusEntries);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);

	const [format, setFormat] = useState<Format>('pdf');
	const [poiScope, setPoiScope] = useState<PoiScope>('allInStage');
	const [aiNarrative, setAiNarrative] = useState(false);
	const [aiPhase, setAiPhase] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const cardRef = usePopoverFocusTrap(open);

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

	const handleGenerate = async (): Promise<void> => {
		if (!stagePlan) return;
		const controller = new AbortController();
		abortRef.current = controller;
		setGenerating(true);
		setProgress(null);
		setExportError(null);
		try {
			let brief: TripBrief = assembleTripBrief({
				stagePlan,
				poisFile,
				enhancedTrailPoints,
				elevationPoints: enhancedTrailPoints,
				selectedPoiIds: starredPoiIds,
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
					waterCarryLabel: (dryStretchKm: number): string | undefined => {
						const liters = waterCarryLiters(dryStretchKm, walkingPaceKmh, waterConsumptionLph);
						if (liters <= 0) return undefined;
						return t('waterCarry', {
							volume: formatVolume(liters, units),
							total: formatWeight(packTotalKg(packBaseWeightKg, liters), units),
						});
					},
				}),
			});

			// Per-day elevation thumbnails for the exporters; canvas-only, so
			// attached here rather than in the pure assembler.
			brief = {
				...brief,
				days: brief.days.map((day) => {
					const thumb = renderElevationThumbnail(enhancedTrailPoints, day.startKm, day.endKm, direction === 'NOBO');
					return thumb ? { ...day, elevationThumb: thumb } : day;
				}),
			};

			// AI narratives are best-effort: any failure (offline, rate limit,
			// unconfigured deploy, model hiccup) keeps the templated text and
			// the export proceeds.
			if (aiNarrative) {
				setAiPhase(true);
				const ai = await fetchAiNarratives(brief, controller.signal);
				setAiPhase(false);
				if (ai) {
					// The disclaimer is resolved here (not in the exporters) because
					// the export pipeline runs outside React/next-intl.
					brief = applyAiNarratives(brief, ai, t('aiDisclaimer'));
				} else if (!controller.signal.aborted) {
					console.warn('AI narrative unavailable; exporting with templated text.');
				}
			}

			const onProgress = (current: number, total: number): void => setProgress({ current, total });
			if (format === 'pdf') {
				await exportTripBriefPdf({
					brief,
					enhancedTrailPoints,
					map,
					onProgress,
					signal: controller.signal,
				});
			} else {
				await exportTripBriefDocx({ brief, onProgress, signal: controller.signal });
			}
			onClose();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			// AbortError means the user cancelled - no error feedback needed.
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				console.error('Trip brief generation failed:', msg);
				setExportError(t('exportError'));
			}
		} finally {
			setGenerating(false);
			setAiPhase(false);
			setProgress(null);
			abortRef.current = null;
		}
	};

	const handleCancel = useCallback((): void => {
		abortRef.current?.abort();
		onClose();
	}, [onClose]);

	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') handleCancel();
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [open, handleCancel]);

	if (!open) return null;

	return (
		<div
			aria-labelledby="trip-brief-title"
			aria-modal="true"
			className="z-modal fixed inset-0 flex items-center justify-center bg-[var(--modal-backdrop-bg)] p-4"
			role="dialog"
			onClick={onClose}
		>
			<div
				className="w-full max-w-sm rounded bg-[var(--map-tooltip-bg)] p-4 shadow-xl dark:bg-[var(--bg-primary)]"
				ref={cardRef}
				onClick={(e) => e.stopPropagation()}
			>
				<h3
					className="text-cldt-blue mb-2 text-base font-semibold dark:text-[var(--text-primary)]"
					id="trip-brief-title"
				>
					{t('title')}
				</h3>
				<p className="mb-3 text-xs text-gray-600 dark:text-[var(--text-secondary)]">{t('description')}</p>

				{!enabled && <p className="mb-2 text-xs text-amber-700 italic dark:text-amber-300">{t('needsPlan')}</p>}

				<fieldset className="mb-3 flex flex-col gap-1">
					<legend className="text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
						{t('format')}
					</legend>
					<label className="flex items-center gap-2 text-sm text-gray-700 dark:text-[var(--text-primary)]">
						<Radio checked={format === 'pdf'} name="trip-brief-format" value="pdf" onChange={() => setFormat('pdf')} />
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
				</fieldset>

				<fieldset className="mb-3 flex flex-col gap-1">
					<legend className="text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
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
							starredPoiIds.size > 0
								? 'cursor-pointer text-gray-700 dark:text-[var(--text-primary)]'
								: 'cursor-not-allowed text-gray-400 dark:text-gray-600',
						)}
						title={starredPoiIds.size > 0 ? undefined : t('poisSelectedComingSoon')}
					>
						<Radio
							checked={poiScope === 'selected'}
							disabled={starredPoiIds.size === 0}
							name="trip-brief-pois"
							value="selected"
							onChange={() => setPoiScope('selected')}
						/>
						<span className={starredPoiIds.size === 0 ? 'line-through' : undefined}>
							{t('poisSelected')}
							{starredPoiIds.size > 0 && (
								<span className="ml-1 text-xs text-amber-600 dark:text-amber-400">({starredPoiIds.size})</span>
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

				{generating && aiPhase && (
					<p className="mb-2 text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('aiGenerating')}</p>
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
					<Button size="sm" variant="mapControlOutlineSecondary" onClick={handleCancel}>
						{generating ? t('cancel') : t('close')}
					</Button>
					<Button
						disabled={!enabled || generating}
						size="sm"
						variant="mapControlOutline"
						onClick={() => void handleGenerate()}
					>
						{generating ? t('generating') : t('generate')}
					</Button>
				</div>
			</div>
		</div>
	);
}
