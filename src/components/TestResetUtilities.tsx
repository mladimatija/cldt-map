'use client';

/**
 * Dev-only state reset utilities for the /test page. Reproducible testing
 * needs clean slates; these buttons replace DevTools spelunking through
 * localStorage, sessionStorage, Cache Storage, and IndexedDB. Destructive
 * actions are two-step (click arms, second click fires).
 */
import React, { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/** zustand persist key for the map store (see map-store.ts). */
const PERSIST_KEY = 'cldt-map-storage';
/** Session-scoped banner-dismissal keys. */
const DISMISSAL_KEYS = ['cldt-dismissed-notices', 'cldt-dismissed-weather-warnings', 'cldt-dismissed-mine-warnings'];
/** Offline POI asset bucket (see poi-prefetch.ts). */
const POI_CACHE_NAME = 'cldt-pois-v1';

export function TestResetUtilities(): React.ReactElement {
	const t = useTranslations('storeTest');
	const clearCompletion = useMapStore((s: MapStoreState) => s.clearCompletion);
	const userWaypoints = useMapStore((s: MapStoreState) => s.userWaypoints);
	const removeUserWaypoint = useMapStore((s: MapStoreState) => s.removeUserWaypoint);
	const journalEntries = useMapStore((s: MapStoreState) => s.journalEntries);
	const removeJournalEntry = useMapStore((s: MapStoreState) => s.removeJournalEntry);
	const setPackGearList = useMapStore((s: MapStoreState) => s.setPackGearList);
	const setPackBaseWeightKg = useMapStore((s: MapStoreState) => s.setPackBaseWeightKg);
	const importedTracks = useMapStore((s: MapStoreState) => s.importedTracks);
	const removeImportedTrack = useMapStore((s: MapStoreState) => s.removeImportedTrack);
	const clearTileCacheForProvider = useMapStore((s: MapStoreState) => s.clearTileCacheForProvider);

	const [armed, setArmed] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);
	/** Mirrors `armed` synchronously: two rapid clicks both close over the
	 *  same stale state value, so the second would re-arm instead of run. */
	const armedRef = useRef<string | null>(null);

	const clearDismissals = (): void => {
		for (const key of DISMISSAL_KEYS) sessionStorage.removeItem(key);
	};

	const clearTracks = async (): Promise<void> => {
		for (const track of importedTracks) await removeImportedTrack(track.id);
	};

	const clearPoiAssets = async (): Promise<void> => {
		if ('caches' in window) await caches.delete(POI_CACHE_NAME);
	};

	const clearWaypointsAndJournal = (): void => {
		for (const wp of userWaypoints) removeUserWaypoint(wp.id);
		for (const entry of journalEntries) removeJournalEntry(entry.id);
	};

	const clearPack = (): void => {
		setPackGearList(null);
		setPackBaseWeightKg(null);
	};

	const clearPersistedStore = (): void => {
		localStorage.removeItem(PERSIST_KEY);
		window.location.reload();
	};

	const resetEverything = async (): Promise<void> => {
		clearCompletion();
		clearWaypointsAndJournal();
		clearPack();
		clearDismissals();
		await clearTracks();
		await clearPoiAssets();
		await clearTileCacheForProvider();
		clearPersistedStore();
	};

	const actions: { id: string; label: string; run: () => void | Promise<void>; reloads?: boolean }[] = [
		{ id: 'completion', label: t('reset.completion'), run: clearCompletion },
		{ id: 'dismissed', label: t('reset.dismissed'), run: clearDismissals },
		{ id: 'tracks', label: t('reset.tracks'), run: clearTracks },
		{ id: 'waypoints', label: t('reset.waypoints'), run: clearWaypointsAndJournal },
		{ id: 'pack', label: t('reset.pack'), run: clearPack },
		{ id: 'tiles', label: t('reset.tiles'), run: () => clearTileCacheForProvider() },
		{ id: 'poiAssets', label: t('reset.poiAssets'), run: clearPoiAssets },
		{ id: 'store', label: t('reset.store'), run: clearPersistedStore, reloads: true },
		{ id: 'everything', label: t('reset.everything'), run: resetEverything, reloads: true },
	];

	const handleClick = async (action: (typeof actions)[number]): Promise<void> => {
		if (armedRef.current !== action.id) {
			armedRef.current = action.id;
			setArmed(action.id);
			setDone(null);
			return;
		}
		armedRef.current = null;
		setArmed(null);
		await action.run();
		if (!action.reloads) setDone(action.id);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('reset.title')}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-2">
				<p className="text-sm text-gray-600">{t('reset.description')}</p>
				{actions.map((action) => (
					<div className="flex items-center gap-2 text-sm" key={action.id}>
						<span className="min-w-0 flex-1 text-gray-700">{action.label}</span>
						{done === action.id && <span className="text-cldt-green text-xs">{t('reset.done')}</span>}
						<Button
							size="sm"
							variant={armed === action.id ? 'selected' : 'base'}
							onClick={() => void handleClick(action)}
						>
							{armed === action.id ? t('reset.confirm') : t('reset.run')}
						</Button>
					</div>
				))}
			</CardContent>
		</Card>
	);
}
