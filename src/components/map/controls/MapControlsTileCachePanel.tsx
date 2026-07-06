'use client';

/**
 * Offline maps section rendered inside the settings popover.
 * Reads trail data and provider from the store; drives the tile pre-cache workflow.
 * Implements: download, cancel, progress, cache info, clear, re-download, auto-sync, staleness.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import {
	isProviderCacheable,
	isCacheStale,
	generateTrailTileUrls,
	getTileUrlTemplate,
	getProviderCacheKey,
	getProviderTileCount,
	buildHighDetailAheadSlice,
	generateAheadHighDetailTileUrls,
	PRECACHE_ZOOM_MIN,
	PRECACHE_ZOOM_MAX,
	HIGH_DETAIL_AHEAD_KM,
} from '@/lib/tile-cache';
import { clearPoiAssetCache, getPoiAssetCount } from '@/lib/poi-prefetch';
import { tileCacheTtlDays, TRAIL_OFF_TRAIL_THRESHOLD_M } from '@/lib/config';
import { formatDistance, isMobile } from '@/lib/utils';
import { downloadGpxFile } from '@/lib/gpx-export';
import { Button } from '@/components/ui/Button';
import { SettingsToggleRow } from './SettingsToggleRow';
import { CacheHealthStatus } from './CacheHealthStatus';
import {
	IoCloudDownloadOutline,
	IoDownloadOutline,
	IoTrashOutline,
	IoRefreshOutline,
	IoWarningOutline,
	IoEllipsisHorizontal,
} from 'react-icons/io5';

function formatAge(cachedAt: number, t: ReturnType<typeof useTranslations<'tileCache'>>): string {
	const diffMs = Date.now() - cachedAt;
	const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
	if (diffDays === 0) return t('today');
	if (diffDays === 1) return t('yesterday');
	return t('daysAgo', { days: diffDays });
}

interface MapControlsTileCachePanelProps {
	embedded?: boolean;
}

export function MapControlsTileCachePanel({ embedded = false }: MapControlsTileCachePanelProps): React.ReactElement {
	const t = useTranslations('tileCache');
	const tGpx = useTranslations('gpx');

	// Store state
	const baseMapProvider = useMapStore((s: MapStoreState) => s.baseMapProvider);
	const tileCacheDownloading = useMapStore((s: MapStoreState) => s.tileCacheDownloading);
	const tileCacheDone = useMapStore((s: MapStoreState) => s.tileCacheDone);
	const tileCacheTotal = useMapStore((s: MapStoreState) => s.tileCacheTotal);
	const tileCacheError = useMapStore((s: MapStoreState) => s.tileCacheError);
	const tileCacheFailed = useMapStore((s: MapStoreState) => s.tileCacheFailed);
	const tileCacheMeta = useMapStore((s: MapStoreState) => s.tileCacheMeta);
	const autoSync = useMapStore((s: MapStoreState) => s.autoSync);
	const predictivePrecache = useMapStore((s: MapStoreState) => s.predictivePrecache);
	const offlineHighDetailAheadEnabled = useMapStore((s: MapStoreState) => s.offlineHighDetailAheadEnabled);
	const direction = useMapStore((s: MapStoreState) => s.direction);
	const userLocation = useMapStore((s: MapStoreState) => s.userLocation);
	const poiPrefetchVersion = useMapStore((s: MapStoreState) => s.poiPrefetchVersion);
	const poiPrefetchSkipped = useMapStore((s: MapStoreState) => s.poiPrefetchSkipped);
	const gpxLoaded = useMapStore((s: MapStoreState) => s.gpxLoaded);
	const rawGpxData = useMapStore((s: MapStoreState) => s.rawGpxData);
	const startTileDownload = useMapStore((s: MapStoreState) => s.startTileDownload);
	const cancelTileDownload = useMapStore((s: MapStoreState) => s.cancelTileDownload);
	const retryFailedTiles = useMapStore((s: MapStoreState) => s.retryFailedTiles);
	const clearTileCacheForProvider = useMapStore((s: MapStoreState) => s.clearTileCacheForProvider);
	const loadTileCacheMeta = useMapStore((s: MapStoreState) => s.loadTileCacheMeta);
	const setAutoSync = useMapStore((s: MapStoreState) => s.setAutoSync);
	const setPredictivePrecache = useMapStore((s: MapStoreState) => s.setPredictivePrecache);
	const setOfflineHighDetailAheadEnabled = useMapStore((s: MapStoreState) => s.setOfflineHighDetailAheadEnabled);
	const startHighDetailAheadDownload = useMapStore((s: MapStoreState) => s.startHighDetailAheadDownload);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);
	const closestPoint = useStore((s: StoreState) => s.closestPoint);
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);

	// Live tile count local state
	const [liveCount, setLiveCount] = useState<number | null>(null);
	const [querying, setQuerying] = useState(false);
	const [confirmClearAll, setConfirmClearAll] = useState(false);
	const confirmYesRef = useRef<HTMLButtonElement>(null);
	// On mobile, downloads are gated behind a confirm row warning about storage
	// and cellular data instead of starting on the first tap.
	const [pendingMobileDownload, setPendingMobileDownload] = useState<null | 'base' | 'redownload' | 'highDetail'>(null);
	const confirmDownloadRef = useRef<HTMLButtonElement>(null);

	// Live POI-asset count (images + Wikipedia summaries cached by
	// `prefetchPoiAssets`). Refreshed when the download finishes and after a
	// manual clear so the user sees the cache flip back to 0.
	const [poiAssetCount, setPoiAssetCount] = useState<number | null>(null);
	const refreshPoiAssetCount = useCallback(async (): Promise<void> => {
		setPoiAssetCount(await getPoiAssetCount());
	}, []);
	const handleClearPoiAssets = useCallback(async (): Promise<void> => {
		await clearPoiAssetCache();
		await refreshPoiAssetCount();
	}, [refreshPoiAssetCount]);

	const cacheable = isProviderCacheable(baseMapProvider);
	const stale = isCacheStale(tileCacheMeta);
	const hasCache = !!tileCacheMeta;
	const highDetailAheadDistance = useMemo(
		() => formatDistance(HIGH_DETAIL_AHEAD_KM, units, distancePrecision),
		[units, distancePrecision],
	);

	const refreshLiveCount = useCallback(async (providerKey: string) => {
		setQuerying(true);
		try {
			const count = await getProviderTileCount(providerKey);
			setLiveCount(count);
		} finally {
			setQuerying(false);
		}
	}, []);

	// Load meta and live count when provider changes
	useEffect(() => {
		if (!baseMapProvider) return;
		const key = getProviderCacheKey(baseMapProvider);
		void loadTileCacheMeta(key);
		queueMicrotask(() => void refreshLiveCount(key));
	}, [baseMapProvider, loadTileCacheMeta, refreshLiveCount]);

	// Refresh live count when download finishes
	const prevDownloading = useRef(false);
	useEffect(() => {
		if (prevDownloading.current && !tileCacheDownloading && baseMapProvider) {
			void refreshLiveCount(getProviderCacheKey(baseMapProvider));
		}
		prevDownloading.current = tileCacheDownloading;
	}, [tileCacheDownloading, baseMapProvider, refreshLiveCount]);

	// Probe the POI asset count on mount, then refresh whenever the background
	// prefetch increments the store counter.
	useEffect(() => {
		queueMicrotask(() => void refreshPoiAssetCount());
	}, [poiPrefetchVersion, refreshPoiAssetCount]);

	// Focus [Yes] button when clear-all confirmation row appears
	useEffect(() => {
		if (confirmClearAll) {
			confirmYesRef.current?.focus();
		}
	}, [confirmClearAll]);

	// Focus the confirm button when the mobile download warning appears
	useEffect(() => {
		if (pendingMobileDownload) {
			confirmDownloadRef.current?.focus();
		}
	}, [pendingMobileDownload]);

	// Estimate tile count for the current provider (memoized as it's expensive to compute)
	const estimatedTileCount = useMemo(() => {
		if (!gpxLoaded || !enhancedTrailPoints?.length || !cacheable) return 0;
		const template = getTileUrlTemplate(baseMapProvider);
		if (!template) return 0;
		return generateTrailTileUrls(enhancedTrailPoints, template, PRECACHE_ZOOM_MIN, PRECACHE_ZOOM_MAX).length;
	}, [gpxLoaded, enhancedTrailPoints, cacheable, baseMapProvider]);

	const estimatedAheadHighDetailTiles = useMemo(() => {
		if (!gpxLoaded || !enhancedTrailPoints?.length || !cacheable) return 0;
		const template = getTileUrlTemplate(baseMapProvider);
		if (!template) return 0;
		const slice = buildHighDetailAheadSlice({
			points: enhancedTrailPoints,
			direction,
			userLocation,
			closestPoint,
			offTrailThresholdM: TRAIL_OFF_TRAIL_THRESHOLD_M,
		});
		if (slice.length < 2) return 0;
		return generateAheadHighDetailTileUrls(slice, template).length;
	}, [gpxLoaded, enhancedTrailPoints, cacheable, baseMapProvider, direction, userLocation, closestPoint]);

	const runBaseDownload = useCallback((): void => {
		if (!enhancedTrailPoints?.length) return;
		void startTileDownload(enhancedTrailPoints, baseMapProvider);
	}, [enhancedTrailPoints, startTileDownload, baseMapProvider]);

	const runRedownload = useCallback(async (): Promise<void> => {
		await clearTileCacheForProvider(getProviderCacheKey(baseMapProvider));
		setLiveCount(0);
		runBaseDownload();
	}, [clearTileCacheForProvider, baseMapProvider, runBaseDownload]);

	const runHighDetailDownload = useCallback((): void => {
		void startHighDetailAheadDownload();
	}, [startHighDetailAheadDownload]);

	const runPendingDownload = useCallback(
		(kind: 'base' | 'redownload' | 'highDetail'): void => {
			if (kind === 'base') runBaseDownload();
			else if (kind === 'redownload') void runRedownload();
			else runHighDetailDownload();
		},
		[runBaseDownload, runRedownload, runHighDetailDownload],
	);

	// On mobile, surface the storage/data warning first; otherwise download now.
	const requestDownload = (kind: 'base' | 'redownload' | 'highDetail'): void => {
		if (isMobile()) {
			setPendingMobileDownload(kind);
			return;
		}
		runPendingDownload(kind);
	};

	const confirmMobileDownload = (): void => {
		const kind = pendingMobileDownload;
		setPendingMobileDownload(null);
		if (kind) runPendingDownload(kind);
	};

	const zoomRangeLabel =
		tileCacheMeta?.hasHighDetailAhead === true
			? t('zoomRangeWithHighDetail', {
					min: tileCacheMeta.zoomMin,
					max: tileCacheMeta.zoomMax,
				})
			: tileCacheMeta
				? t('zoomRange', { min: tileCacheMeta.zoomMin, max: tileCacheMeta.zoomMax })
				: null;

	const handleClear = async (): Promise<void> => {
		await clearTileCacheForProvider(getProviderCacheKey(baseMapProvider));
		setLiveCount(0);
	};

	/** Hand the already-loaded full-trail GPX to an offline GPS app (OsmAnd /
	 *  Locus / Gaia) from the same place the corridor tiles were cached. Downloads
	 *  the raw track verbatim; no new persisted state, no auto-download. */
	const handleSaveTrailGpx = useCallback((): void => {
		if (!rawGpxData) return;
		downloadGpxFile(rawGpxData, tGpx('filenameFullTrail'));
	}, [rawGpxData, tGpx]);

	const handleClearAll = async (): Promise<void> => {
		setConfirmClearAll(false);
		await clearTileCacheForProvider();
		setLiveCount(0);
	};

	const progressPercent = tileCacheTotal > 0 ? Math.round((tileCacheDone / tileCacheTotal) * 100) : 0;

	const content = (
		<>
			{/* Provider not cacheable */}
			{!cacheable && (
				<p className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('providerNotCacheable')}</p>
			)}

			{/* Trail isn't loaded */}
			{cacheable && !gpxLoaded && (
				<p className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{t('noTrailData')}</p>
			)}

			{cacheable && gpxLoaded && (
				<div className="space-y-2">
					{/* One-glance offline-readiness summary above the detailed rows. */}
					<CacheHealthStatus />
					{/* One-tap handoff of the full trail track to an offline GPS app,
					    from the same place the hiker just cached the corridor. */}
					{rawGpxData && (
						<Button
							className="h-8 w-full justify-start text-xs"
							size="sm"
							title={t('saveTrailGpxTooltip')}
							variant="mapControlOutlineSecondary"
							onClick={handleSaveTrailGpx}
						>
							<IoDownloadOutline aria-hidden className="mr-1.5 h-3.5 w-3.5 shrink-0" />
							{t('saveTrailGpx')}
						</Button>
					)}
					{/* Error state */}
					{tileCacheError && !tileCacheDownloading && (
						<p className="text-cldt-red text-xs">
							{tileCacheError === 'quota_exceeded'
								? t('quotaExceeded')
								: tileCacheError === 'not_cacheable'
									? t('providerNotCacheable')
									: t('downloadError')}
						</p>
					)}

					{/* Partial failure: some tiles could not be fetched (flaky wifi).
					    Surface the honest miss count and offer a targeted retry instead
					    of silently reporting the download as complete. */}
					{!tileCacheDownloading && tileCacheFailed > 0 && (
						<div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-500/40 dark:bg-amber-500/10">
							<div className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
								<IoWarningOutline aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span role="status">{t('tilesFailed', { count: tileCacheFailed })}</span>
							</div>
							<Button
								className="h-8 text-xs"
								size="sm"
								variant="mapControlOutline"
								onClick={() => void retryFailedTiles()}
							>
								<IoRefreshOutline aria-hidden className="mr-1 h-3 w-3" />
								{t('retryFailed')}
							</Button>
						</div>
					)}

					{/* Downloading: progress bar */}
					{tileCacheDownloading && (
						<div className="space-y-1.5">
							<div className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
								<span>
									{t('downloading', { done: tileCacheDone.toLocaleString(), total: tileCacheTotal.toLocaleString() })}
								</span>
								<span className="shrink-0 text-gray-500">{progressPercent}%</span>
							</div>
							<div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-[var(--bg-secondary)]">
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
							{/* Mobile download warning (storage + cellular data) */}
							{pendingMobileDownload && (
								<div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-500/40 dark:bg-amber-500/10">
									<div className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
										<IoWarningOutline aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
										<span>{t('mobileDownloadWarning')}</span>
									</div>
									<div className="flex items-center gap-2">
										<Button
											className="h-8 text-xs"
											ref={confirmDownloadRef}
											size="sm"
											variant="mapControlOutline"
											onClick={confirmMobileDownload}
										>
											<IoCloudDownloadOutline aria-hidden className="mr-1 h-3 w-3" />
											{t('mobileDownloadConfirm')}
										</Button>
										<Button
											className="h-8 text-xs"
											size="sm"
											variant="base"
											onClick={() => setPendingMobileDownload(null)}
										>
											{t('confirmNo')}
										</Button>
									</div>
								</div>
							)}

							{/* Cache info row */}
							{hasCache && tileCacheMeta && (
								<div className="space-y-1">
									<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
										<span>
											{t('lastDownloaded', { time: formatAge(tileCacheMeta.cachedAt, t) })}
											{' - '}
											{querying ? (
												<span className="flex items-center gap-1">
													<IoEllipsisHorizontal
														aria-hidden
														className="h-3 w-3 animate-spin motion-reduce:animate-none"
													/>
													{t('querying')}
												</span>
											) : (
												<span>{t('tilesCount', { count: (liveCount ?? 0).toLocaleString() })}</span>
											)}
										</span>
									</div>
									{zoomRangeLabel && (
										<p className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{zoomRangeLabel}</p>
									)}
									{stale && (
										<div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
											<IoWarningOutline aria-hidden className="h-3.5 w-3.5 shrink-0" />
											<span>{t('cacheStale', { days: tileCacheTtlDays })}</span>
										</div>
									)}
									<div className="flex flex-wrap gap-1.5 pt-0.5">
										<Button
											className="h-8 text-xs"
											size="sm"
											variant="mapControlOutlineSecondary"
											onClick={() => void handleClear()}
										>
											<IoTrashOutline aria-hidden className="mr-1 h-3 w-3" />
											{t('clear')}
										</Button>
										<Button
											className="h-8 text-xs"
											size="sm"
											variant="mapControlOutline"
											onClick={() => requestDownload('redownload')}
										>
											<IoRefreshOutline aria-hidden className="mr-1 h-3 w-3" />
											{t('redownload')}
										</Button>
										{!confirmClearAll && (
											<Button
												className="h-8 text-xs"
												size="sm"
												variant="mapControlOutlineSecondary"
												onClick={() => setConfirmClearAll(true)}
											>
												<IoTrashOutline aria-hidden className="mr-1 h-3 w-3" />
												{t('clearAll')}
											</Button>
										)}
									</div>
									{confirmClearAll && (
										<div className="flex items-center gap-2 pt-0.5 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
											<span>{t('confirmClear')}</span>
											<Button
												className="h-8 text-xs"
												ref={confirmYesRef}
												size="sm"
												variant="mapControlOutlineSecondary"
												onClick={() => void handleClearAll()}
											>
												{t('confirmYes')}
											</Button>
											<Button
												className="h-8 text-xs"
												size="sm"
												variant="base"
												onClick={() => setConfirmClearAll(false)}
											>
												{t('confirmNo')}
											</Button>
										</div>
									)}
								</div>
							)}

							{/* Download button (no cache yet or after clear) */}
							{!hasCache && (
								<div className="space-y-0.5">
									<Button
										className="h-8 w-full justify-start text-xs"
										disabled={!enhancedTrailPoints?.length}
										size="sm"
										variant="mapControlOutline"
										onClick={() => requestDownload('base')}
									>
										<IoCloudDownloadOutline aria-hidden className="mr-1.5 h-3.5 w-3.5 shrink-0" />
										{t('download')}
									</Button>
									{estimatedTileCount > 0 && (
										<p className="text-xs text-gray-400 dark:text-[var(--text-secondary)]">
											{t('estimatedTiles', { count: estimatedTileCount.toLocaleString() })}
										</p>
									)}
								</div>
							)}

							<SettingsToggleRow
								checked={autoSync}
								label={t('autoSync')}
								tooltip={t('autoSyncTooltip')}
								onCheckedChange={(checked) => setAutoSync(checked)}
							/>

							{/* POI offline assets: cached image thumbnails + Wikipedia
							    summaries. Populated as a side-effect of the corridor
							    pre-cache so popups stay rich offline. */}
							{poiPrefetchSkipped !== null && poiPrefetchSkipped > 0 && (
								<p className="text-xs text-amber-700 dark:text-amber-400" role="status">
									{t('poiAssetsSkipped', { count: poiPrefetchSkipped })}
								</p>
							)}
							<div className="flex items-center justify-between gap-2">
								<span className="text-sm text-gray-700 dark:text-[var(--text-primary)]">
									{t('poiAssets', { count: poiAssetCount ?? 0 })}
								</span>
								<Button
									aria-label={t('clearPoiAssets')}
									className="relative !px-2 !py-1.5 text-xs before:absolute before:inset-[-12px]"
									disabled={!poiAssetCount}
									variant="mapControlOutlineSecondary"
									onClick={() => void handleClearPoiAssets()}
								>
									{t('clearPoiAssets')}
								</Button>
							</div>

							<SettingsToggleRow
								checked={predictivePrecache}
								disabled={!hasCache}
								label={t('predictive.label')}
								tooltip={t('predictive.hint')}
								onCheckedChange={(checked) => setPredictivePrecache(checked)}
							/>

							<SettingsToggleRow
								checked={offlineHighDetailAheadEnabled}
								disabled={!hasCache}
								label={t('highDetailAhead.label')}
								tooltip={t('highDetailAhead.hint', { distance: highDetailAheadDistance })}
								onCheckedChange={(checked) => setOfflineHighDetailAheadEnabled(checked)}
							/>
							{offlineHighDetailAheadEnabled && hasCache && estimatedAheadHighDetailTiles > 0 && (
								<div className="space-y-1">
									<div className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
										<IoWarningOutline aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
										<span>
											{t('highDetailAhead.storageWarning', {
												count: estimatedAheadHighDetailTiles.toLocaleString(),
												distance: highDetailAheadDistance,
											})}
										</span>
									</div>
									<Button
										className="h-8 w-full justify-start text-xs"
										disabled={tileCacheDownloading}
										size="sm"
										variant="mapControlOutline"
										onClick={() => requestDownload('highDetail')}
									>
										<IoCloudDownloadOutline aria-hidden className="mr-1.5 h-3.5 w-3.5 shrink-0" />
										{t('highDetailAhead.download')}
									</Button>
								</div>
							)}
						</>
					)}
				</div>
			)}
		</>
	);

	if (embedded) {
		return <div className="flex flex-col gap-2">{content}</div>;
	}

	return (
		<div className="mt-1 border-t border-gray-200 pt-2 dark:border-[var(--border-color)]">
			<div className="mb-1.5 flex items-center gap-1.5">
				<IoCloudDownloadOutline
					aria-hidden
					className="h-4 w-4 shrink-0 text-gray-500 dark:text-[var(--text-secondary)]"
				/>
				<span className="text-xs font-medium text-gray-600 dark:text-[var(--text-primary)]">{t('title')}</span>
			</div>
			{content}
		</div>
	);
}
