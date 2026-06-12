'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import type { ImportedTrack, TrackStats } from '@/lib/store/types';
import { computeTrackStats } from '@/lib/imported-tracks';
import { buildSpatialGrid } from '@/lib/spatial-grid';
import { formatEta, formatDistanceM, formatPaceFromSecPerKm } from '@/lib/distance-utils';
import { findPoisNearTrack } from '@/lib/poi-proximity';
import { isKnownType, poiDisplayName } from '@/lib/pois';
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
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);

	/** Stats computed AFTER first paint, one track per frame, against a
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
			// Apply the same enabled-type filter the live map uses so the
			// report shows the user the POIs they've actually opted into.
			const visiblePois = poisFile.pois.filter((p) => isKnownType(p.type) && enabledPoiTypes.has(p.type));
			const hits = findPoisNearTrack(track.points, visiblePois);
			setProximityByTrackId((prev) => ({ ...prev, [track.id]: hits }));
		}
	};

	const fitToTrack = (track: ImportedTrack): void => {
		if (track.points.length === 0) return;
		// Single numeric min/max pass; the previous reduce allocated a LatLng
		// and a bounds-extend call per point, which on a recorded multi-day
		// hike made every row click visibly stall.
		let minLat = Infinity;
		let maxLat = -Infinity;
		let minLng = Infinity;
		let maxLng = -Infinity;
		for (const pt of track.points) {
			if (pt.lat < minLat) minLat = pt.lat;
			if (pt.lat > maxLat) maxLat = pt.lat;
			if (pt.lng < minLng) minLng = pt.lng;
			if (pt.lng > maxLng) maxLng = pt.lng;
		}
		map.fitBounds(L.latLngBounds([minLat, minLng], [maxLat, maxLng]), { padding: [20, 20] });
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
								<div className="mt-1 flex items-center gap-2 pl-5">
									<Button
										aria-label={
											track.visible === false
												? t('showTrack', { trackName: track.name })
												: t('hideTrack', { trackName: track.name })
										}
										size="sm"
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
										size="sm"
										variant="mapControlOutlineSecondary"
										onClick={() => void removeImportedTrack(track.id)}
									>
										<IoTrashOutline aria-hidden className="h-3.5 w-3.5" />
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
														// Both values are already km; needsConversion would divide by 1000 again.
														const distLabel = formatDistance(hit.minDistanceM / 1000, units, distancePrecision);
														const atLabel = formatDistance(hit.atTrackKm, units, 1);
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
