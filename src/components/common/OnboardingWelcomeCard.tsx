'use client';

/**
 * First-run welcome card (onboarding Layer 1).
 *
 * A one-time, dismissible card shown on the very first map visit. It gives a
 * dense feature-rich app a "zero-setup" entry point: a one-line framing plus a
 * few launchers into the highest-value panels and a link to the live demo, so
 * a new user finds the core 20% without hunting the control rail. Shown once
 * (a persisted `onboardingSeen` flag), never during a demo session, and
 * account-free / analytics-free in keeping with the privacy-first positioning.
 *
 * Accessibility, focus trap, Escape / backdrop / corner-X dismiss all come from
 * the shared MapControlModalShell.
 */

import React, { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { IoArrowForwardOutline, IoPlayCircleOutline } from 'react-icons/io5';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { MapControlModalShell } from '@/components/map/controls/MapControlModalShell';
import { MAP_CONTROL_LINK_BUTTON } from '@/components/map/controls/map-controls-constants';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { cn } from '@/lib/utils';

/** Launchers into the highest-value panels (panel ids match `setOpenPanel`). */
const LAUNCHERS = [
	{ key: 'plan', panel: 'stagePlanner' },
	{ key: 'places', panel: 'poiList' },
	{ key: 'offline', panel: 'settings' },
	{ key: 'help', panel: 'help' },
] as const;

const emptySubscribe = (): (() => void) => () => {};

/** True only on the client, after hydration - so the card never renders during
 *  SSR (the persisted `onboardingSeen` flag is unavailable there), avoiding a
 *  hydration mismatch and a one-frame flash for returning visitors. */
function useIsClient(): boolean {
	return useSyncExternalStore(
		emptySubscribe,
		() => true,
		() => false,
	);
}

export default function OnboardingWelcomeCard(): React.ReactElement | null {
	const t = useTranslations('onboarding');
	const onboardingSeen = useMapStore((s: MapStoreState) => s.onboardingSeen);
	const markOnboardingSeen = useMapStore((s: MapStoreState) => s.markOnboardingSeen);
	const setOpenPanel = useMapStore((s: MapStoreState) => s.setOpenPanel);
	const demoModeActive = useMapStore((s: MapStoreState) => s.demoModeActive);

	const isClient = useIsClient();

	if (!isClient || onboardingSeen || demoModeActive) return null;

	const openAndDismiss = (panel: string): void => {
		setOpenPanel(panel);
		markOnboardingSeen();
	};

	return (
		<MapControlModalShell
			open
			cardClassName="max-w-md"
			closeLabel={t('dismiss')}
			title={t('title')}
			titleId="onboarding-title"
			onClose={markOnboardingSeen}
		>
			<p className="m-0 text-sm text-gray-600 dark:text-[var(--text-secondary)]">{t('body')}</p>

			<div className="mt-1 flex flex-col gap-0.5">
				{LAUNCHERS.map(({ key, panel }) => (
					<button
						className={cn(MAP_CONTROL_LINK_BUTTON, 'flex min-h-[44px] w-full items-center gap-2 py-2')}
						key={key}
						type="button"
						onClick={() => openAndDismiss(panel)}
					>
						<IoArrowForwardOutline aria-hidden className="h-3.5 w-3.5 shrink-0" />
						{t(`launch.${key}`)}
					</button>
				))}
			</div>

			<div className="mt-2 flex flex-wrap items-center justify-between gap-2">
				<Link
					className="text-cldt-blue hover:text-cldt-green focus-visible:text-cldt-green focus-visible:ring-cldt-green inline-flex min-h-[44px] items-center gap-1 text-sm outline-none hover:underline focus-visible:underline focus-visible:ring-1 focus-visible:ring-offset-1"
					href="/demo"
					onClick={markOnboardingSeen}
				>
					<IoPlayCircleOutline aria-hidden className="h-4 w-4 shrink-0" />
					{t('demo')}
				</Link>
				<Button className="min-h-[44px]" variant="mapControlOutline" onClick={markOnboardingSeen}>
					{t('gotIt')}
				</Button>
			</div>
		</MapControlModalShell>
	);
}
