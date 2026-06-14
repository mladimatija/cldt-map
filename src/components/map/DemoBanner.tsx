'use client';

/** Top banner chip on /demo with pause, resume, and exit controls. */
import React from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { exitDemoSession } from '@/lib/demo-session';
import { pauseWalkSim, resumeWalkSim } from '@/lib/walk-sim';
import { Button } from '@/components/ui/Button';
import { IoFootstepsOutline } from 'react-icons/io5';
import { COMPACT_BANNER_CHIP_CLASSES } from './banner-styles';

export function DemoBanner(): React.ReactElement | null {
	const t = useTranslations('demo');
	const router = useRouter();
	const pathname = usePathname();
	const demoModeActive = useMapStore((s: MapStoreState) => s.demoModeActive);
	const walkSim = useMapStore((s: MapStoreState) => s.walkSim);

	if (!demoModeActive || pathname !== '/demo') return null;

	const handleExit = (): void => {
		exitDemoSession();
		router.push('/');
	};

	return (
		<div aria-live="polite" className={`${COMPACT_BANNER_CHIP_CLASSES} map-tooltip--demo flex-wrap`} role="status">
			<IoFootstepsOutline aria-hidden className="h-3.5 w-3.5 shrink-0" />
			<span className="font-medium">{t('bannerLabel')}</span>
			<span aria-hidden className="opacity-45 select-none">
				·
			</span>
			<span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
				{walkSim?.running ? (
					<Button variant="bannerInline" onClick={pauseWalkSim}>
						{t('pause')}
					</Button>
				) : walkSim ? (
					<Button variant="bannerInlinePrimary" onClick={resumeWalkSim}>
						{t('resume')}
					</Button>
				) : null}
				<Button variant="bannerInline" onClick={handleExit}>
					{t('exit')}
				</Button>
			</span>
		</div>
	);
}
