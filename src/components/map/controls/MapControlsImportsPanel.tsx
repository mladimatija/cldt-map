'use client';

import React, { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import type { ImportedTrack } from '@/lib/store/types';
import { computeTrackStats } from '@/lib/imported-tracks';
import { formatEta, formatDistanceM, formatPaceFromSecPerKm } from '@/lib/distance-utils';
import { findPoisNearTrack } from '@/lib/poi-proximity';
import { isKnownType, poiDisplayName } from '@/lib/pois';
import { formatDistance } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { IoDownloadOutline } from 'react-icons/io5';

export function MapControlsImportsPanel(): React.ReactElement {
	const t = useTranslations('imports');
	const map = useMap();

	const locale = useLocale();
	const tPois = useTranslations('pois');
	const importedTracks = useMapStore((s: MapStoreState) => s.importedTracks);
	const removeImportedTrack = useMapStore((s: MapStoreState) => s.removeImportedTrack);
	const hoveredImportedTrackId = useMapStore((s: MapStoreState) => s.hoveredImportedTrackId);
	const setHoveredImportedTrackId = useMapStore((s: MapStoreState) => s.setHoveredImportedTrackId);
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);
	const poisFile = useMapStore((s: MapStoreState) => s.poisFile);
	const enabledPoiTypes = useMapStore((s: MapStoreState) => s.enabledPoiTypes);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);

	const trackStats = useMemo(
		() => importedTracks.map((track) => computeTrackStats(track, enhancedTrailPoints)),
		[importedTracks, enhancedTrailPoints],
	);

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
			// Apply the same enabled-type filter the live map uses so the
			// report shows the user the POIs they've actually opted into.
			const visiblePois = poisFile.pois.filter((p) => isKnownType(p.type) && enabledPoiTypes.has(p.type));
			const hits = findPoisNearTrack(track.points, visiblePois);
			setProximityByTrackId((prev) => ({ ...prev, [track.id]: hits }));
		}
	};

	const fitToTrack = (track: ImportedTrack): void => {
		if (track.points.length === 0) return;
		const bounds = track.points.reduce(
			(b, p) => b.extend([p.lat, p.lng] as L.LatLngTuple),
			L.latLngBounds([
				[track.points[0].lat, track.points[0].lng],
				[track.points[0].lat, track.points[0].lng],
			]),
		);
		map.fitBounds(bounds, { padding: [20, 20] });
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
					{importedTracks.map((track, i) => {
						const stats = trackStats[i];
						const isHovered = hoveredImportedTrackId === track.id;
						return (
							<li
								className={`rounded p-1.5 transition-colors ${isHovered ? 'bg-gray-100 dark:bg-[var(--bg-secondary)]' : ''}`}
								key={track.id}
								onMouseEnter={() => setHoveredImportedTrackId(track.id)}
								onMouseLeave={() => setHoveredImportedTrackId(null)}
							>
								<button
									className="focus-visible:ring-cldt-green flex w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
									type="button"
									onClick={() => fitToTrack(track)}
								>
									<span aria-hidden className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: track.color }} />
									<span className="flex-1 truncate text-xs font-medium text-gray-700 dark:text-[var(--text-primary)]">
										{track.name}
									</span>
								</button>
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
								<div className="mt-1 flex items-center gap-2 pl-5">
									<Button
										aria-label={t('removeAriaLabel', { trackName: track.name })}
										size="sm"
										variant="mapControlOutlineSecondary"
										onClick={() => void removeImportedTrack(track.id)}
									>
										✕
									</Button>
									{poisFile?.pois?.length ? (
										<button
											aria-expanded={expandedTrackId === track.id}
											className="text-cldt-blue focus-visible:ring-cldt-green rounded text-xs underline focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
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
													{hits.map((hit) => {
														const name = poiDisplayName(hit.poi, locale);
														const typeLabel = tPois(`type.${hit.poi.type}`, { default: hit.poi.type });
														const distLabel = formatDistance(hit.minDistanceM / 1000, units, distancePrecision, true);
														const atLabel = formatDistance(hit.atTrackKm, units, 1, true);
														return (
															<div
																className="flex items-baseline gap-2 py-0.5 text-xs text-gray-700 dark:text-[var(--text-primary)]"
																key={hit.poi.id}
															>
																<span className="truncate font-medium">{name}</span>
																<span className="ml-auto shrink-0 text-[10px] text-gray-500 dark:text-gray-400">
																	{typeLabel} · {distLabel} ({atLabel})
																</span>
															</div>
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
