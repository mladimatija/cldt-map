'use client';

/**
 * Combined radar animation player and precipitation legend.
 * Rendered as a single row above the elevation chart.
 * Visible only when the radar overlay is enabled and frames are loaded.
 */
import React, { useEffect } from 'react';
import { IoPlayOutline, IoPauseOutline } from 'react-icons/io5';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';

const FRAME_INTERVAL_MS = 600;
const GRADIENT = 'linear-gradient(to right, #9ec8f0, #24d324, #f0f024, #f08024, #f02424)';

export function RadarControls(): React.ReactElement | null {
	const t = useTranslations('weather');
	const showRadarOverlay = useMapStore((state: MapStoreState) => state.showRadarOverlay);
	const radarFrames = useMapStore((state: MapStoreState) => state.radarFrames);
	const radarFrameIndex = useMapStore((state: MapStoreState) => state.radarFrameIndex);
	const radarPlaying = useMapStore((state: MapStoreState) => state.radarPlaying);
	const setRadarPlaying = useMapStore((state: MapStoreState) => state.setRadarPlaying);

	useEffect(() => {
		if (!radarPlaying || !radarFrames.length) return;
		const id = setInterval(() => {
			const { radarFrameIndex: idx, radarFrames: frames, setRadarFrameIndex } = useMapStore.getState();
			setRadarFrameIndex((idx + 1) % frames.length);
		}, FRAME_INTERVAL_MS);
		return () => clearInterval(id);
	}, [radarPlaying, radarFrames.length]);

	if (!showRadarOverlay || !radarFrames.length) return null;

	const currentFrame = radarFrames[radarFrameIndex];
	const timestamp = currentFrame
		? new Date(currentFrame.time * 1000).toLocaleTimeString([], {
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
			})
		: '--:--';

	return (
		<div className="flex items-center gap-2.5 self-start rounded-lg bg-white/80 px-2.5 py-1.5 shadow backdrop-blur-sm dark:bg-zinc-800/80">
			{/* Player controls */}
			<button
				aria-label={radarPlaying ? t('pauseRadar') : t('playRadar')}
				className="flex items-center justify-center text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
				type="button"
				onClick={() => setRadarPlaying(!radarPlaying)}
			>
				{radarPlaying ? <IoPauseOutline size={16} /> : <IoPlayOutline size={16} />}
			</button>
			<span className="text-[11px] text-zinc-600 tabular-nums dark:text-zinc-400">{timestamp}</span>
			<span className="text-[10px] text-zinc-400 dark:text-zinc-500">
				{radarFrameIndex + 1}/{radarFrames.length}
			</span>

			{/* Divider */}
			<div className="h-4 w-px bg-zinc-200 dark:bg-zinc-600" />

			{/* Precipitation legend */}
			<div className="flex flex-col gap-0.5">
				<div className="h-2.5 w-24 rounded-sm" style={{ background: GRADIENT }} />
				<div className="flex justify-between text-[9px] text-zinc-500 dark:text-zinc-400">
					<span>{t('legendNone')}</span>
					<span>{t('legendLight')}</span>
					<span>{t('legendModerate')}</span>
					<span>{t('legendHeavy')}</span>
				</div>
			</div>
		</div>
	);
}
