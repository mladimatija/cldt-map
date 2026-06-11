'use client';

/**
 * Dev-only walk simulator UI for the /test page. The engine lives in
 * src/lib/walk-sim.ts at module scope, so a started walk keeps moving while
 * you navigate to the map page and watch the app react: location tooltip,
 * distance/ETA HUD, weather, completion auto-track, off-route alert,
 * GPS-triggered banners, predictive precache.
 */
import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import {
	pauseWalkSim,
	releaseWalkSim,
	resumeWalkSim,
	setWalkSimDirection,
	setWalkSimOffset,
	setWalkSimSpeed,
	startWalkSim,
	stopWalkSim,
} from '@/lib/walk-sim';
import type { TrailDirection } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Radio } from '@/components/ui/Radio';

const SPEED_OPTIONS_KMH = [4, 12, 40, 200, 1000];
const INPUT_CLS =
	'w-24 rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 dark:border-gray-600 dark:bg-transparent dark:text-white';

export function TestWalkSimulator(): React.ReactElement {
	const t = useTranslations('storeTest');
	const walkSim = useMapStore((s: MapStoreState) => s.walkSim);

	const [startKm, setStartKm] = useState(100);
	const [speedKmh, setSpeedKmh] = useState(40);
	const [direction, setDirection] = useState<TrailDirection>('SOBO');
	const [offsetM, setOffsetM] = useState(0);
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState(false);

	const handleStart = async (): Promise<void> => {
		setLoading(true);
		setLoadError(false);
		const ok = await startWalkSim({ startKm, speedKmh, walkDirection: direction, offsetM });
		setLoading(false);
		if (!ok) setLoadError(true);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('walk.title')}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-sm text-gray-600">{t('walk.description')}</p>

				<div className="flex flex-wrap items-end gap-4">
					<label className="flex flex-col gap-1 text-xs text-gray-600">
						{t('walk.startKm')}
						<input
							className={INPUT_CLS}
							min={0}
							type="number"
							value={startKm}
							onChange={(e) => setStartKm(Number(e.target.value))}
						/>
					</label>
					<label className="flex flex-col gap-1 text-xs text-gray-600">
						{t('walk.speed')}
						<select
							className={INPUT_CLS}
							value={speedKmh}
							onChange={(e) => {
								const v = Number(e.target.value);
								setSpeedKmh(v);
								setWalkSimSpeed(v);
							}}
						>
							{SPEED_OPTIONS_KMH.map((v) => (
								<option key={v} value={v}>
									{v} km/h
								</option>
							))}
						</select>
					</label>
					<div className="flex flex-col gap-1 text-xs text-gray-600">
						{t('walk.direction')}
						<div className="flex items-center gap-3 py-1.5">
							{(['SOBO', 'NOBO'] as const).map((d) => (
								<label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-700" key={d}>
									<Radio
										checked={direction === d}
										name="walk-direction"
										onChange={() => {
											setDirection(d);
											setWalkSimDirection(d);
										}}
									/>
									{d}
								</label>
							))}
						</div>
					</div>
				</div>

				<label className="flex flex-col gap-1 text-xs text-gray-600">
					{t('walk.offset', { distance: offsetM })}
					<input
						className="w-full"
						max={2500}
						min={0}
						step={10}
						type="range"
						value={offsetM}
						onChange={(e) => {
							const v = Number(e.target.value);
							setOffsetM(v);
							setWalkSimOffset(v);
						}}
					/>
				</label>

				<div className="flex flex-wrap gap-2">
					{!walkSim && (
						<Button disabled={loading} size="default" variant="primary" onClick={() => void handleStart()}>
							{loading ? t('walk.loading') : t('walk.start')}
						</Button>
					)}
					{walkSim?.running && (
						<Button size="default" variant="base" onClick={pauseWalkSim}>
							{t('walk.pause')}
						</Button>
					)}
					{walkSim && !walkSim.running && (
						<Button size="default" variant="primary" onClick={resumeWalkSim}>
							{t('walk.resume')}
						</Button>
					)}
					{walkSim && (
						<Button size="default" variant="base" onClick={stopWalkSim}>
							{t('walk.stop')}
						</Button>
					)}
					<Button size="default" variant="base" onClick={releaseWalkSim}>
						{t('walk.release')}
					</Button>
				</div>

				{loadError && <p className="text-cldt-red m-0 text-sm">{t('walk.loadError')}</p>}
				{walkSim && (
					<div className="space-y-1 text-sm">
						<p className="m-0">
							<span className="font-mono font-semibold">{walkSim.posKm.toFixed(2)}</span> / {walkSim.totalKm.toFixed(0)}{' '}
							km · {walkSim.running ? t('walk.running') : t('walk.paused')} · {walkSim.walkDirection} ·{' '}
							{walkSim.offsetM} m
						</p>
						<div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
							<div
								className="bg-cldt-blue h-full rounded-full"
								style={{ width: `${walkSim.totalKm > 0 ? (walkSim.posKm / walkSim.totalKm) * 100 : 0}%` }}
							/>
						</div>
					</div>
				)}
				<p className="m-0 text-xs text-gray-500">{t('walk.hint')}</p>
			</CardContent>
		</Card>
	);
}
