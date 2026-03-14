'use client';

/**
 * Offline maps section rendered inside the settings popover.
 * Reads trail data and provider from the store; drives the tile pre-cache workflow.
 * Implements: download, cancel, progress, cache info, clear, re-download, auto-sync, staleness.
 */
import React, { useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import {
	isProviderCacheable,
	isCacheStale,
	generateTrailTileUrls,
	getTileUrlTemplate,
	getProviderCacheKey,
	PRECACHE_ZOOM_MIN,
	PRECACHE_ZOOM_MAX,
} from '@/lib/tile-cache';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import SmartTooltip from '@/components/ui/SmartTooltip';
import {
	IoCloudDownloadOutline,
	IoTrashOutline,
	IoRefreshOutline,
	IoWarningOutline,
	IoHelpCircleOutline,
} from 'react-icons/io5';

function formatAge(cachedAt: number, t: ReturnType<typeof useTranslations<'tileCache'>>): string {
	const diffMs = Date.now() - cachedAt;
	const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
	if (diffDays === 0) return t('today');
	if (diffDays === 1) return t('yesterday');
	return t('daysAgo', { days: diffDays });
}

export function MapControlsTileCachePanel(): React.ReactElement {
	const t = useTranslations('tileCache');

	// Store state
	const baseMapProvider = useMapStore((s: MapStoreState) => s.baseMapProvider);
	const tileCacheDownloading = useMapStore((s: MapStoreState) => s.tileCacheDownloading);
	const tileCacheDone = useMapStore((s: MapStoreState) => s.tileCacheDone);
	const tileCacheTotal = useMapStore((s: MapStoreState) => s.tileCacheTotal);
	const tileCacheError = useMapStore((s: MapStoreState) => s.tileCacheError);
	const tileCacheMeta = useMapStore((s: MapStoreState) => s.tileCacheMeta);
	const autoSync = useMapStore((s: MapStoreState) => s.autoSync);
	const gpxLoaded = useMapStore((s: MapStoreState) => s.gpxLoaded);
	const startTileDownload = useMapStore((s: MapStoreState) => s.startTileDownload);
	const cancelTileDownload = useMapStore((s: MapStoreState) => s.cancelTileDownload);
	const clearTileCacheForProvider = useMapStore((s: MapStoreState) => s.clearTileCacheForProvider);
	const loadTileCacheMeta = useMapStore((s: MapStoreState) => s.loadTileCacheMeta);
	const setAutoSync = useMapStore((s: MapStoreState) => s.setAutoSync);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);

	const cacheable = isProviderCacheable(baseMapProvider);
	const stale = isCacheStale(tileCacheMeta);
	const hasCache = !!tileCacheMeta && tileCacheMeta.tileCount > 0;

	// Load existing meta when provider changes
	useEffect(() => {
		if (!baseMapProvider) return;
		void loadTileCacheMeta(getProviderCacheKey(baseMapProvider));
	}, [baseMapProvider, loadTileCacheMeta]);

	// Estimate tile count for the current provider (memoized as it's expensive to compute)
	const estimatedTileCount = useMemo(() => {
		if (!gpxLoaded || !enhancedTrailPoints?.length || !cacheable) return 0;
		const template = getTileUrlTemplate(baseMapProvider);
		if (!template) return 0;
		return generateTrailTileUrls(enhancedTrailPoints, template, PRECACHE_ZOOM_MIN, PRECACHE_ZOOM_MAX).length;
	}, [gpxLoaded, enhancedTrailPoints, cacheable, baseMapProvider]);

	const handleDownload = (): void => {
		if (!enhancedTrailPoints?.length) return;
		void startTileDownload(enhancedTrailPoints, baseMapProvider);
	};

	const handleRedownload = async (): Promise<void> => {
		const { getProviderCacheKey } = await import('@/lib/tile-cache');
		await clearTileCacheForProvider(getProviderCacheKey(baseMapProvider));
		handleDownload();
	};

	const handleClear = (): void => {
		void clearTileCacheForProvider(getProviderCacheKey(baseMapProvider));
	};

	const progressPercent = tileCacheTotal > 0 ? Math.round((tileCacheDone / tileCacheTotal) * 100) : 0;

	return (
		<div className="mt-1 border-t border-gray-200 pt-2 dark:border-gray-600">
			<div className="mb-1.5 flex items-center gap-1.5">
				<IoCloudDownloadOutline aria-hidden className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-300" />
				<span className="text-xs font-medium text-gray-600 dark:text-gray-200">{t('title')}</span>
			</div>

			{/* Provider not cacheable */}
			{!cacheable && <p className="text-xs text-gray-500 dark:text-gray-400">{t('providerNotCacheable')}</p>}

			{/* Trail isn't loaded */}
			{cacheable && !gpxLoaded && <p className="text-xs text-gray-500 dark:text-gray-400">{t('noTrailData')}</p>}

			{cacheable && gpxLoaded && (
				<div className="space-y-2">
					{/* Error state */}
					{tileCacheError && !tileCacheDownloading && (
						<p className="text-xs text-red-600 dark:text-red-400">
							{tileCacheError === 'quota_exceeded'
								? t('quotaExceeded')
								: tileCacheError === 'not_cacheable'
									? t('providerNotCacheable')
									: t('downloadError')}
						</p>
					)}

					{/* Downloading: progress bar */}
					{tileCacheDownloading && (
						<div className="space-y-1.5">
							<div className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-300">
								<span>
									{t('downloading', { done: tileCacheDone.toLocaleString(), total: tileCacheTotal.toLocaleString() })}
								</span>
								<span className="shrink-0 text-gray-500">{progressPercent}%</span>
							</div>
							<div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
								<div
									className="bg-cldt-blue h-full rounded-full transition-all duration-300"
									style={{ width: `${progressPercent}%` }}
								/>
							</div>
							<Button size="sm" variant="base" onClick={cancelTileDownload}>
								{t('cancel')}
							</Button>
						</div>
					)}

					{/* Idle: download or cache info */}
					{!tileCacheDownloading && (
						<>
							{/* Cache info row */}
							{hasCache && tileCacheMeta && (
								<div className="space-y-1">
									<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-600 dark:text-gray-300">
										<span>{t('lastDownloaded', { time: formatAge(tileCacheMeta.cachedAt, t) })}</span>
										<span className="text-gray-400">·</span>
										<span>{t('tilesCached', { count: tileCacheMeta.tileCount.toLocaleString() })}</span>
									</div>
									{stale && (
										<div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
											<IoWarningOutline aria-hidden className="h-3.5 w-3.5 shrink-0" />
											<span>{t('cacheStale')}</span>
										</div>
									)}
									<div className="flex gap-1.5 pt-0.5">
										<Button size="sm" variant="base" onClick={handleClear}>
											<IoTrashOutline aria-hidden className="mr-1 h-3 w-3" />
											{t('clear')}
										</Button>
										<Button size="sm" variant="base" onClick={() => void handleRedownload()}>
											<IoRefreshOutline aria-hidden className="mr-1 h-3 w-3" />
											{t('redownload')}
										</Button>
									</div>
								</div>
							)}

							{/* Download button (no cache yet or after clear) */}
							{!hasCache && (
								<div className="space-y-0.5">
									<Button
										className="w-full justify-start text-xs"
										disabled={!enhancedTrailPoints?.length}
										size="sm"
										variant="mapControlOutline"
										onClick={handleDownload}
									>
										<IoCloudDownloadOutline aria-hidden className="mr-1.5 h-3.5 w-3.5 shrink-0" />
										{t('download')}
									</Button>
									{estimatedTileCount > 0 && (
										<p className="text-xs text-gray-400 dark:text-gray-500">
											{t('estimatedTiles', { count: estimatedTileCount.toLocaleString() })}
										</p>
									)}
								</div>
							)}

							{/* Auto-sync toggle */}
							<label className="flex cursor-pointer items-center gap-2">
								<Checkbox checked={autoSync} onCheckedChange={(checked) => setAutoSync(checked)} />
								<span className="text-sm text-gray-700 dark:text-gray-200">{t('autoSync')}</span>
								<span
									className="inline-flex"
									onClick={(e) => e.stopPropagation()}
									onMouseDown={(e) => e.stopPropagation()}
								>
									<SmartTooltip content={t('autoSyncTooltip')} position="top">
										<IoHelpCircleOutline className="ml-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
									</SmartTooltip>
								</span>
							</label>
						</>
					)}
				</div>
			)}
		</div>
	);
}
