'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { IoCheckmarkCircle, IoWarning, IoCloudOfflineOutline, IoCloudDownloadOutline } from 'react-icons/io5';
import { type IconType } from 'react-icons';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { isCacheStale, isStoragePersisted } from '@/lib/tile-cache';
import { getAppUpdateWaiting } from '@/lib/sw-update';

/** Derived corridor cache state, worst-first. */
type CorridorState = 'downloading' | 'absent' | 'outdated' | 'incomplete' | 'ready';
/** Overall headline badge, folding the corridor state together with a waiting app build. */
type HeadlineState = 'updating' | 'notReady' | 'almost' | 'ready';

const TONE = {
	good: 'text-green-700 dark:text-green-300',
	warn: 'text-amber-700 dark:text-amber-300',
	muted: 'text-gray-500 dark:text-[var(--text-secondary)]',
} as const;

const AMBER_BOX = 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10';

const HEADLINE: Record<HeadlineState, { Icon: IconType; box: string; tone: string }> = {
	updating: {
		Icon: IoCloudDownloadOutline,
		box: 'border-cldt-blue/40 bg-cldt-blue/5 dark:border-cldt-blue/50 dark:bg-cldt-blue/10',
		tone: 'text-cldt-blue',
	},
	ready: {
		Icon: IoCheckmarkCircle,
		box: 'border-green-300 bg-green-50 dark:border-green-500/40 dark:bg-green-500/10',
		tone: TONE.good,
	},
	almost: { Icon: IoWarning, box: AMBER_BOX, tone: TONE.warn },
	notReady: { Icon: IoCloudOfflineOutline, box: AMBER_BOX, tone: TONE.warn },
};

/**
 * One-glance offline-readiness summary at the top of the offline-maps panel.
 * Aggregates signals that already exist - corridor cache presence, staleness,
 * and tile misses, plus whether durable storage was granted and whether a newer
 * app build is waiting - into a single "ready / almost ready / not ready"
 * readout, so a hiker can confirm they are good to go offline without parsing
 * the detailed rows below.
 *
 * Read-only: the storage and SW signals are read through shared lib helpers
 * (`isStoragePersisted`, `isAppUpdateWaiting`) rather than re-deriving the
 * controller-gate / feature-detection here.
 */
export function CacheHealthStatus(): React.ReactElement {
	const t = useTranslations('tileCache');
	const tileCacheMeta = useMapStore((s: MapStoreState) => s.tileCacheMeta);
	const tileCacheFailed = useMapStore((s: MapStoreState) => s.tileCacheFailed);
	const tileCacheDownloading = useMapStore((s: MapStoreState) => s.tileCacheDownloading);

	// Mount-time snapshots (this panel is a transient popover that remounts on
	// reopen, so they need not be live): null storageDurable = unknown/unsupported.
	const [storageDurable, setStorageDurable] = useState<boolean | null>(null);
	const [appUpdateReady, setAppUpdateReady] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void isStoragePersisted().then((persisted) => {
			if (!cancelled) setStorageDurable(persisted);
		});
		void getAppUpdateWaiting().then((waiting) => {
			if (!cancelled) setAppUpdateReady(waiting);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const corridor: CorridorState = tileCacheDownloading
		? 'downloading'
		: !tileCacheMeta
			? 'absent'
			: isCacheStale(tileCacheMeta)
				? 'outdated'
				: tileCacheFailed > 0
					? 'incomplete'
					: 'ready';

	// Fold a waiting app build into the headline so the green "ready" badge never
	// sits directly above an amber "update ready" row. Best-effort storage stays
	// muted (not a blocker), so it does not demote the badge.
	const headlineState: HeadlineState =
		corridor === 'downloading'
			? 'updating'
			: corridor === 'absent'
				? 'notReady'
				: corridor === 'ready' && !appUpdateReady
					? 'ready'
					: 'almost';

	const corridorValue: Record<CorridorState, { text: string; tone: string }> = {
		downloading: { text: t('readiness.corridorDownloading'), tone: TONE.muted },
		absent: { text: t('readiness.corridorAbsent'), tone: TONE.warn },
		outdated: { text: t('readiness.corridorOutdated'), tone: TONE.warn },
		incomplete: { text: t('readiness.corridorIncomplete', { count: tileCacheFailed }), tone: TONE.warn },
		ready: { text: t('readiness.corridorReady'), tone: TONE.good },
	};

	const storageValue =
		storageDurable === true
			? { text: t('readiness.storageDurable'), tone: TONE.good }
			: { text: t('readiness.storageBestEffort'), tone: TONE.muted };

	const appValue = appUpdateReady
		? { text: t('readiness.appUpdateReady'), tone: TONE.warn }
		: { text: t('readiness.appCurrent'), tone: TONE.good };

	const { Icon, box, tone } = HEADLINE[headlineState];

	return (
		<div className={`space-y-1 rounded-md border p-2 ${box}`}>
			<div className={`flex items-center gap-1.5 text-xs font-semibold ${tone}`}>
				<Icon
					aria-hidden="true"
					className={`h-4 w-4 shrink-0 ${headlineState === 'updating' ? 'animate-pulse motion-reduce:animate-none' : ''}`}
				/>
				<span>{t(`readiness.${headlineState}Title`)}</span>
			</div>
			<dl className="space-y-0.5 text-xs">
				<StatusLine label={t('readiness.corridorLabel')} value={corridorValue[corridor]} />
				<StatusLine label={t('readiness.storageLabel')} value={storageValue} />
				<StatusLine label={t('readiness.appLabel')} value={appValue} />
			</dl>
		</div>
	);
}

function StatusLine({ label, value }: { label: string; value: { text: string; tone: string } }): React.ReactElement {
	return (
		<div className="flex items-baseline justify-between gap-2">
			<dt className="text-gray-500 dark:text-[var(--text-secondary)]">{label}</dt>
			<dd className={`text-right font-medium ${value.tone}`}>{value.text}</dd>
		</div>
	);
}
