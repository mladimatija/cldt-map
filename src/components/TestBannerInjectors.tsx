'use client';

/**
 * Dev-only banner/alert injectors for the /test page. Each of these banners
 * triggers only under rare real-world conditions (a CAP storm polygon over
 * your GPS, a seasonal closure at your trail km, residual-risk mine data, a
 * failed trail download); the buttons fabricate exactly the store state the
 * real trigger produces, around the current (usually simulated) location.
 * Injection logic lives at module scope operating on the stores directly -
 * the component only renders buttons and flags.
 */
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import type * as GeoJSON from 'geojson';
import { useMapStore, useStore, type MapStoreState } from '@/lib/store';
import type { SeasonalStatusFile } from '@/lib/seasonal-status';
import type { MineAreasFile } from '@/lib/mine-areas';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const SevereWeatherBanner = dynamic(
	() => import('@/components/map/SevereWeatherBanner').then((m) => ({ default: m.SevereWeatherBanner })),
	{ ssr: false },
);
const SeasonalStatusBanner = dynamic(
	() => import('@/components/map/SeasonalStatusBanner').then((m) => ({ default: m.SeasonalStatusBanner })),
	{ ssr: false },
);
const MineAreaBanner = dynamic(
	() => import('@/components/map/MineAreaBanner').then((m) => ({ default: m.MineAreaBanner })),
	{ ssr: false },
);

/** Fallback injection point when no (simulated) GPS fix exists: mid-Croatia. */
const FALLBACK = { lat: 44.5, lng: 16.0 };

/** Real files stashed on inject so Clear restores instead of nuking. */
let stashedSeasonal: SeasonalStatusFile | null = null;
let stashedMine: MineAreasFile | null = null;

function squareAround(lat: number, lng: number, halfDeg: number): GeoJSON.Polygon {
	return {
		type: 'Polygon',
		coordinates: [
			[
				[lng - halfDeg, lat - halfDeg],
				[lng + halfDeg, lat - halfDeg],
				[lng + halfDeg, lat + halfDeg],
				[lng - halfDeg, lat + halfDeg],
				[lng - halfDeg, lat - halfDeg],
			],
		],
	};
}

function injectionPoint(): { lat: number; lng: number } {
	return useMapStore.getState().userLocation ?? FALLBACK;
}

function injectSevereWeather(): void {
	const at = injectionPoint();
	useMapStore.getState().setSevereWeatherData({
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				geometry: squareAround(at.lat, at.lng, 0.2),
				properties: {
					severity: 'red',
					event: 'TEST: thunderstorm cell',
					validFrom: new Date().toISOString(),
					validUntil: new Date(Date.now() + 6 * 3600_000).toISOString(),
					source: 'Test injector',
				},
			},
		],
	});
}

function injectSeasonalClosure(alreadyInjected: boolean): void {
	const mapStore = useMapStore.getState();
	const closestPoint = useStore.getState().closestPoint;
	const km = closestPoint ? closestPoint.distanceFromStart / 1000 : 100;
	if (!alreadyInjected) stashedSeasonal = mapStore.seasonalStatusFile;
	const today = new Date().toISOString().slice(0, 10);
	const validUntil = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
	mapStore.setSeasonalStatusFile({
		lastUpdated: today,
		source: 'Test injector',
		entries: [
			{
				id: 'test-closure',
				severity: 'closed_recommended',
				distanceStartKm: Math.max(0, km - 2),
				distanceEndKm: km + 2,
				validFrom: today,
				validUntil,
				note_en: 'TEST: injected closure for banner testing.',
				note_hr: 'TEST: umjetno zatvaranje za testiranje trake.',
				source: 'Test injector',
			},
		],
	});
}

function clearSeasonalClosure(): void {
	useMapStore.getState().setSeasonalStatusFile(stashedSeasonal);
	stashedSeasonal = null;
}

function injectMineArea(alreadyInjected: boolean): void {
	const mapStore = useMapStore.getState();
	const at = injectionPoint();
	if (!alreadyInjected) stashedMine = mapStore.mineAreasFile;
	mapStore.setMineAreasFile({
		lastUpdated: new Date().toISOString().slice(0, 10),
		source: 'Test injector',
		areas: [
			{
				id: 'msp-test',
				name: 'TEST area',
				geometry: squareAround(at.lat, at.lng, 0.01),
				bbox: [at.lng - 0.01, at.lat - 0.01, at.lng + 0.01, at.lat + 0.01],
			},
		],
		trailRanges: [],
	});
}

function clearMineArea(): void {
	useMapStore.getState().setMineAreasFile(stashedMine);
	stashedMine = null;
}

interface InjectorRowProps {
	label: string;
	injected: boolean;
	injectLabel: string;
	clearLabel: string;
	onInject: () => void;
	onClear: () => void;
}

function InjectorRow({
	label,
	injected,
	injectLabel,
	clearLabel,
	onInject,
	onClear,
}: InjectorRowProps): React.ReactElement {
	return (
		<div className="flex items-center gap-2 text-sm">
			<span className="min-w-0 flex-1 text-gray-700">{label}</span>
			<Button size="sm" variant={injected ? 'selected' : 'base'} onClick={onInject}>
				{injectLabel}
			</Button>
			<Button disabled={!injected} size="sm" variant="base" onClick={onClear}>
				{clearLabel}
			</Button>
		</div>
	);
}

export function TestBannerInjectors(): React.ReactElement {
	const t = useTranslations('storeTest');

	const userLocation = useMapStore((s: MapStoreState) => s.userLocation);
	const severeWeatherData = useMapStore((s: MapStoreState) => s.severeWeatherData);
	const setSevereWeatherData = useMapStore((s: MapStoreState) => s.setSevereWeatherData);
	const gpxLoadFailed = useMapStore((s: MapStoreState) => s.gpxLoadFailed);
	const setGpxLoadFailed = useMapStore((s: MapStoreState) => s.setGpxLoadFailed);
	const showStaleCacheNotification = useMapStore((s: MapStoreState) => s.showStaleCacheNotification);
	const setStaleCacheNotification = useMapStore((s: MapStoreState) => s.setStaleCacheNotification);

	const [seasonalInjected, setSeasonalInjected] = useState(false);
	const [mineInjected, setMineInjected] = useState(false);

	const injectLabel = t('inject.inject');
	const clearLabel = t('inject.clear');

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('inject.title')}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="text-sm text-gray-600">{t('inject.description')}</p>

				<InjectorRow
					clearLabel={clearLabel}
					injectLabel={injectLabel}
					injected={!!severeWeatherData}
					label={t('inject.severeWeather')}
					onClear={() => setSevereWeatherData(null)}
					onInject={injectSevereWeather}
				/>
				<InjectorRow
					clearLabel={clearLabel}
					injectLabel={injectLabel}
					injected={seasonalInjected}
					label={t('inject.seasonal')}
					onClear={() => {
						clearSeasonalClosure();
						setSeasonalInjected(false);
					}}
					onInject={() => {
						injectSeasonalClosure(seasonalInjected);
						setSeasonalInjected(true);
					}}
				/>
				<InjectorRow
					clearLabel={clearLabel}
					injectLabel={injectLabel}
					injected={mineInjected}
					label={t('inject.mineArea')}
					onClear={() => {
						clearMineArea();
						setMineInjected(false);
					}}
					onInject={() => {
						injectMineArea(mineInjected);
						setMineInjected(true);
					}}
				/>
				<InjectorRow
					clearLabel={clearLabel}
					injectLabel={injectLabel}
					injected={gpxLoadFailed === true}
					label={t('inject.gpxError')}
					onClear={() => setGpxLoadFailed(false)}
					onInject={() => setGpxLoadFailed(true)}
				/>
				<InjectorRow
					clearLabel={clearLabel}
					injectLabel={injectLabel}
					injected={showStaleCacheNotification}
					label={t('inject.staleCache')}
					onClear={() => setStaleCacheNotification(false)}
					onInject={() => setStaleCacheNotification(true)}
				/>
				{!userLocation && <p className="m-0 text-xs text-gray-500">{t('inject.needLocation')}</p>}

				{/* Strip banners render inline; floating ones anchor to this box. */}
				<div className="relative min-h-24 rounded border border-dashed border-gray-300">
					<SevereWeatherBanner />
					<SeasonalStatusBanner />
					<MineAreaBanner />
					<p className="px-3 py-2 text-sm text-gray-500">{t('inject.previewNote')}</p>
				</div>
			</CardContent>
		</Card>
	);
}
