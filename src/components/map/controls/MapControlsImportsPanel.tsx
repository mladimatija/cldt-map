'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import type { ImportedTrack, TrackStats } from '@/lib/store/types';
import { computeTrackStats, trackBounds } from '@/lib/imported-tracks';
import { buildSpatialGrid } from '@/lib/spatial-grid';
import { formatEta, formatDistanceM, formatPaceFromSecPerKm } from '@/lib/distance-utils';
import { findPoisNearTrack } from '@/lib/poi-proximity';
import {
	downloadCoverageReportCsv,
	exportCoverageReportPdf,
	type CoverageReportContent,
	type CoverageReportPoiRow,
} from '@/lib/import-coverage-report';
import { formatIsoDate } from '@/lib/date-format';
import { isKnownType, poiDisplayName, poiPassesReachabilityFilter } from '@/lib/pois';
import { formatDistance } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { IoDownloadOutline, IoEyeOffOutline, IoEyeOutline, IoTrashOutline } from 'react-icons/io5';

export function MapControlsImportsPanel(): React.ReactElement {
	const t = useTranslations('imports');
	const map = useMap();

	const locale = useLocale();
	const tPois = useTranslations('pois');
	const importedTracks = useMapStore((s: MapStoreState) => s.importedTracks);
	const removeImportedTrack = useMapStore((s: MapStoreState) => s.removeImportedTrack);
	const updateImportedTrack = useMapStore((s: MapStoreState) => s.updateImportedTrack);
	const hoveredImportedTrackId = useMapStore((s: MapStoreState) => s.hoveredImportedTrackId);
	const setHoveredImportedTrackId = useMapStore((s: MapStoreState) => s.setHoveredImportedTrackId);
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);
	const poisFile = useMapStore((s: MapStoreState) => s.poisFile);
	const enabledPoiTypes = useMapStore((s: MapStoreState) => s.enabledPoiTypes);
	const includeRemotePois = useMapStore((s: MapStoreState) => s.includeRemotePois);
	const togglePoiType = useMapStore((s: MapStoreState) => s.togglePoiType);
	const requestOpenPoi = useMapStore((s: MapStoreState) => s.requestOpenPoi);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);

	/** Stats computed AFTER the first paint, one track per frame, against a
	 *  single shared spatial grid. computeTrackStats memoises by content
	 *  hash, so after the first pass this effect is a cache walk - the panel
	 *  opens instantly regardless of how many multi-MB tracks are loaded. */
	const [trackStats, setTrackStats] = useState<Record<string, TrackStats>>({});
	const statsRunRef = useRef(0);
	useEffect(() => {
		const runId = ++statsRunRef.current;
		if (importedTracks.length === 0 || enhancedTrailPoints.length === 0) return;
		const grid = buildSpatialGrid(enhancedTrailPoints);
		let i = 0;
		const tick = (): void => {
			if (runId !== statsRunRef.current || i >= importedTracks.length) return;
			const track = importedTracks[i];
			const stats = computeTrackStats(track, enhancedTrailPoints, grid);
			setTrackStats((prev) => (prev[track.id] === stats ? prev : { ...prev, [track.id]: stats }));
			i++;
			if (i < importedTracks.length) setTimeout(tick, 0);
		};
		const start = setTimeout(tick, 0);
		return () => clearTimeout(start);
	}, [importedTracks, enhancedTrailPoints]);

	/** POI proximity hits per track, computed lazily per track id so a
	 *  several-MB recorded hike doesn't block the panel mount. Only the
	 *  ids the user has expanded get walked. */
	const [proximityByTrackId, setProximityByTrackId] = useState<Record<string, ReturnType<typeof findPoisNearTrack>>>(
		{},
	);
	const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null);

	const toggleProximity = (track: ImportedTrack): void => {
		if (expandedTrackId === track.id) {
			setExpandedTrackId(null);
			return;
		}
		setExpandedTrackId(track.id);
		if (!proximityByTrackId[track.id] && poisFile?.pois?.length) {
			const hits = computePoiHits(track);
			setProximityByTrackId((prev) => ({ ...prev, [track.id]: hits }));
		}
	};

	const computePoiHits = (track: ImportedTrack): ReturnType<typeof findPoisNearTrack> => {
		if (!poisFile?.pois?.length) return [];
		const visiblePois = poisFile.pois.filter(
			(p) => isKnownType(p.type) && enabledPoiTypes.has(p.type) && poiPassesReachabilityFilter(p, includeRemotePois),
		);
		return findPoisNearTrack(track.points, visiblePois);
	};

	const buildReportContent = (track: ImportedTrack, stats: TrackStats): CoverageReportContent => {
		const hits = proximityByTrackId[track.id] ?? computePoiHits(track);
		const poiRows: CoverageReportPoiRow[] = hits.map((hit) => {
			const closestDistance = formatDistance(hit.minDistanceM / 1000, units, distancePrecision);
			const atTrackKm = formatDistance(hit.atTrackKm, units, 1);
			return {
				name: poiDisplayName(hit.poi, locale),
				type: tPois(`type.${hit.poi.type}`, { default: hit.poi.type }),
				closestDistance,
				atTrackKm,
				summaryLine: t('poiHitSummary', { closest: closestDistance, atRecording: atTrackKm }),
			};
		});
		const now = new Date();
		return {
			title: t('reportTitle'),
			trackLabel: t('reportTrack'),
			trackName: track.name,
			importedLabel: t('reportImportedAt'),
			importedAt: formatIsoDate(new Date(track.importedAt).toISOString().slice(0, 10), locale),
			generatedLabel: t('reportGeneratedAt'),
			generatedAt: now.toLocaleString(locale === 'en' ? 'en-GB' : locale),
			summaryHeading: t('reportSummaryHeading'),
			distanceLabel: t('distance'),
			distanceValue: formatDistanceM(stats.totalDistanceM, units),
			elapsedLabel: t('elapsed'),
			elapsedValue: stats.totalElapsedSec > 0 ? formatEta(stats.totalElapsedSec) : '-',
			movingLabel: t('moving'),
			movingValue: stats.totalMovingSec > 0 ? formatEta(stats.totalMovingSec) : null,
			avgPaceLabel: t('avgPace'),
			avgPaceValue: formatPaceFromSecPerKm(stats.avgMovingPaceSecPerKm, units),
			maxDeviationLabel: t('maxDeviation'),
			maxDeviationValue: `${Math.round(stats.maxDeviationM)} m`,
			coverageLabel: t('coverage'),
			coverageValue: `${stats.coveragePercent.toFixed(0)}%`,
			coverageNote: t('reportCoverageNote'),
			poisHeading: t('reportPoisHeading'),
			poisLegend: t('reportPoisLegend'),
			poisNone: t('reportPoisNone'),
			poiColName: t('reportPoiColName'),
			poiColType: t('reportPoiColType'),
			poiColClosest: t('reportPoiColClosest'),
			poiColAtKm: t('reportPoiColAtKm'),
			poiRows,
		};
	};

	/** Fly to a proximity-hit POI and open its popup; mirrors the up-next
	 *  strip's behavior, enabling the marker layer first if it is off so the
	 *  pending-open request has a marker to land on. */
	const handlePoiHitClick = (poi: { id: string; type: string }): void => {
		if (!enabledPoiTypes.has(poi.type)) togglePoiType(poi.type);
		requestOpenPoi(poi.id);
	};

	const handleExportCsv = (track: ImportedTrack): void => {
		const stats = trackStats[track.id];
		if (!stats) return;
		downloadCoverageReportCsv(buildReportContent(track, stats), track);
	};

	const handleExportPdf = async (track: ImportedTrack): Promise<void> => {
		const stats = trackStats[track.id];
		if (!stats) return;
		await exportCoverageReportPdf(buildReportContent(track, stats), track);
	};

	const fitToTrack = (track: ImportedTrack): void => {
		const bounds = trackBounds(track);
		if (bounds) map.fitBounds(L.latLngBounds(bounds[0], bounds[1]), { padding: [20, 20] });
	};

	const openFilePicker = (): void => {
		document.getElementById('gpx-file-input')?.click();
	};

	return (
		<div className="mt-1 border-t border-gray-200 pt-2 dark:border-[var(--border-color)]">
			<div className="mb-1.5 flex items-center gap-1.5">
				<IoDownloadOutline aria-hidden className="h-4 w-4 shrink-0 text-gray-500 dark:text-[var(--text-secondary)]" />
				<span className="flex-1 text-xs font-medium text-gray-600 dark:text-[var(--text-primary)]">{t('title')}</span>
				<button
					className="text-cldt-blue focus-visible:ring-cldt-green rounded text-xs underline outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
					type="button"
					onClick={openFilePicker}
				>
					{t('pickFile')}
				</button>
			</div>

			{importedTracks.length === 0 ? (
				<p className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('noImports')}</p>
			) : (
				<ul className="space-y-2">
					{importedTracks.map((track) => {
						const stats = trackStats[track.id];
						const isHovered = hoveredImportedTrackId === track.id;
						return (
							<li
								className={`rounded p-1.5 transition-colors ${isHovered ? 'bg-gray-100 dark:bg-[var(--bg-secondary)]' : ''}`}
								key={track.id}
								onMouseEnter={() => setHoveredImportedTrackId(track.id)}
								onMouseLeave={() => setHoveredImportedTrackId(null)}
							>
								<div className="flex w-full items-center gap-2">
									<input
										aria-label={t('colorLabel', { trackName: track.name })}
										className="track-color-input h-4 w-4 shrink-0 cursor-pointer rounded-sm"
										title={t('colorLabel', { trackName: track.name })}
										type="color"
										value={track.color}
										onChange={(e) => updateImportedTrack(track.id, { color: e.target.value })}
									/>
									<button
										className="focus-visible:ring-cldt-green min-w-0 flex-1 cursor-pointer truncate rounded border-0 bg-transparent p-0 text-left text-xs font-medium text-gray-700 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 dark:text-[var(--text-primary)]"
										title={track.name}
										type="button"
										onClick={() => fitToTrack(track)}
									>
										{track.name}
									</button>
								</div>
								<div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-5 text-xs text-gray-500 dark:text-[var(--text-secondary)]">
									<span>
										{t('distance')}: {stats ? formatDistanceM(stats.totalDistanceM, units) : '-'}
									</span>
									<span>
										{t('elapsed')}: {stats && stats.totalElapsedSec > 0 ? formatEta(stats.totalElapsedSec) : '-'}
									</span>
									{stats && stats.totalMovingSec > 0 && (
										<span>
											{t('moving')}: {formatEta(stats.totalMovingSec)}
										</span>
									)}
									<span>
										{t('avgPace')}: {stats ? formatPaceFromSecPerKm(stats.avgMovingPaceSecPerKm, units) : '-'}
									</span>
									<span>
										{t('maxDeviation')}: {stats ? `${Math.round(stats.maxDeviationM)} m` : '-'}
									</span>
									<span>
										{t('coverage')}: {stats ? `${stats.coveragePercent.toFixed(0)}%` : '-'}
									</span>
								</div>
								<div className="mt-1 flex flex-col gap-1.5 pl-5">
									<div className="flex flex-wrap items-center gap-2">
										<Button
											aria-label={
												track.visible === false
													? t('showTrack', { trackName: track.name })
													: t('hideTrack', { trackName: track.name })
											}
											className="h-8 w-8 shrink-0 px-0"
											size="sm"
											title={
												track.visible === false
													? t('showTrack', { trackName: track.name })
													: t('hideTrack', { trackName: track.name })
											}
											variant="mapControlOutlineSecondary"
											onClick={() => updateImportedTrack(track.id, { visible: track.visible === false })}
										>
											{track.visible === false ? (
												<IoEyeOffOutline aria-hidden className="h-3.5 w-3.5" />
											) : (
												<IoEyeOutline aria-hidden className="h-3.5 w-3.5" />
											)}
										</Button>
										<Button
											aria-label={t('removeAriaLabel', { trackName: track.name })}
											className="h-8 w-8 shrink-0 px-0"
											size="sm"
											title={t('removeAriaLabel', { trackName: track.name })}
											variant="mapControlOutlineSecondary"
											onClick={() => void removeImportedTrack(track.id)}
										>
											<IoTrashOutline aria-hidden className="h-3.5 w-3.5" />
										</Button>
										<Button
											className="h-8 shrink-0"
											disabled={!stats}
											size="sm"
											title={t('exportReportCsvTooltip')}
											variant="mapControlOutlineSecondary"
											onClick={() => handleExportCsv(track)}
										>
											{t('exportReportCsv')}
										</Button>
										<Button
											className="h-8 shrink-0"
											disabled={!stats}
											size="sm"
											title={t('exportReportPdfTooltip')}
											variant="mapControlOutlineSecondary"
											onClick={() => void handleExportPdf(track)}
										>
											{t('exportReportPdf')}
										</Button>
									</div>
									{poisFile?.pois?.length ? (
										<button
											aria-expanded={expandedTrackId === track.id}
											className="text-cldt-blue focus-visible:ring-cldt-green w-fit rounded text-xs underline focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
											type="button"
											onClick={() => toggleProximity(track)}
										>
											{expandedTrackId === track.id ? t('hidePoisHit') : t('showPoisHit')}
										</button>
									) : null}
								</div>
								{expandedTrackId === track.id && (
									<div className="mt-1.5 max-h-40 overflow-y-auto rounded border border-gray-100 px-2 py-1 pl-5 text-xs dark:border-[var(--border-color)]">
										{(() => {
											const hits = proximityByTrackId[track.id];
											if (!hits) {
												return (
													<p className="text-gray-500 italic dark:text-[var(--text-secondary)]">{t('poisComputing')}</p>
												);
											}
											if (hits.length === 0) {
												return (
													<p className="text-gray-500 italic dark:text-[var(--text-secondary)]">
														{t('poisNoneNearby')}
													</p>
												);
											}
											return (
												<>
													<p className="mb-1 text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
														{t('poisCountHit', { count: hits.length })}
													</p>
													<p className="mb-1.5 text-[10px] leading-snug text-gray-500 dark:text-gray-400">
														{t('reportPoisLegend')}
													</p>
													{hits.map((hit) => {
														const name = poiDisplayName(hit.poi, locale);
														const typeLabel = tPois(`type.${hit.poi.type}`, { default: hit.poi.type });
														const closestDistance = formatDistance(hit.minDistanceM / 1000, units, distancePrecision);
														const atRecording = formatDistance(hit.atTrackKm, units, 1);
														const summaryLine = t('poiHitSummary', { closest: closestDistance, atRecording });
														return (
															<button
																className="hover:bg-cldt-blue/10 focus-visible:ring-cldt-green flex w-full cursor-pointer items-baseline gap-2 rounded border-0 bg-transparent px-0.5 py-0.5 text-left text-xs text-gray-700 outline-none focus-visible:ring-2 dark:text-[var(--text-primary)]"
																key={hit.poi.id}
																title={name}
																type="button"
																onClick={() => handlePoiHitClick(hit.poi)}
															>
																<span className="truncate font-medium">{name}</span>
																<span className="ml-auto shrink-0 text-[10px] text-gray-500 dark:text-gray-400">
																	{typeLabel} · {summaryLine}
																</span>
															</button>
														);
													})}
												</>
											);
										})()}
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
