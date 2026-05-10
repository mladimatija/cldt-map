'use client';

import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import type { ImportedTrack } from '@/lib/store/types';
import { computeTrackStats } from '@/lib/imported-tracks';
import { formatEta, formatDistanceM, formatPaceFromSecPerKm } from '@/lib/distance-utils';
import { Button } from '@/components/ui/Button';
import { IoDownloadOutline } from 'react-icons/io5';

export function MapControlsImportsPanel(): React.ReactElement {
	const t = useTranslations('imports');
	const map = useMap();

	const importedTracks = useMapStore((s: MapStoreState) => s.importedTracks);
	const removeImportedTrack = useMapStore((s: MapStoreState) => s.removeImportedTrack);
	const hoveredImportedTrackId = useMapStore((s: MapStoreState) => s.hoveredImportedTrackId);
	const setHoveredImportedTrackId = useMapStore((s: MapStoreState) => s.setHoveredImportedTrackId);
	const units = useMapStore((s: MapStoreState) => s.units);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);

	const trackStats = useMemo(
		() => importedTracks.map((track) => computeTrackStats(track, enhancedTrailPoints)),
		[importedTracks, enhancedTrailPoints],
	);

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
					className="text-cldt-blue text-xs underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--cldt-green]"
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
									className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left"
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
								<div className="mt-1 pl-5">
									<Button
										aria-label={t('removeAriaLabel', { trackName: track.name })}
										size="sm"
										variant="mapControlOutlineSecondary"
										onClick={() => void removeImportedTrack(track.id)}
									>
										✕
									</Button>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
