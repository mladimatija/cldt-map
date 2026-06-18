'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { usePopoverFocusTrap } from '@/hooks';
import { Button } from '@/components/ui/Button';

interface TourStep {
	/** Value of the `data-tour` attribute on the element to highlight. */
	target: string;
	/** Key under `tour.steps.<key>` for the title/body copy. */
	key: string;
}

/** Ordered steps, each targeting a stable, always-present control. */
const TOUR_STEPS: TourStep[] = [
	{ target: 'planner', key: 'planner' },
	{ target: 'offline', key: 'offline' },
	{ target: 'help', key: 'help' },
	{ target: 'sos', key: 'sos' },
];

const CALLOUT_WIDTH = 264;
const EDGE_MARGIN = 12;
const SPOTLIGHT_PAD = 6;
/** Rough callout height, used only to keep it inside the viewport vertically. */
const CALLOUT_EST_HEIGHT = 168;

interface Placement {
	spotlight: { top: number; left: number; width: number; height: number };
	callout: { top: number; left: number };
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function computePlacement(rect: DOMRect): Placement {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const spotlight = {
		top: rect.top - SPOTLIGHT_PAD,
		left: rect.left - SPOTLIGHT_PAD,
		width: rect.width + SPOTLIGHT_PAD * 2,
		height: rect.height + SPOTLIGHT_PAD * 2,
	};
	// The controls sit on the right edge, so place the callout to the left of a
	// right-half target and to the right of a left-half one; clamp into view.
	const placeLeft = rect.left + rect.width / 2 > vw / 2;
	const rawLeft = placeLeft ? rect.left - CALLOUT_WIDTH - EDGE_MARGIN : rect.right + EDGE_MARGIN;
	const left = clamp(rawLeft, EDGE_MARGIN, vw - CALLOUT_WIDTH - EDGE_MARGIN);
	const top = clamp(rect.top, EDGE_MARGIN, vh - CALLOUT_EST_HEIGHT - EDGE_MARGIN);
	return { spotlight, callout: { top, left } };
}

/**
 * In-context coachmark tour (onboarding Layer 2). Mounted only while the tour is
 * active (opt-in from the welcome card or the help panel, so it always starts at
 * step 0), it walks the user through a few key controls: each step spotlights a
 * `[data-tour]` target with a dimming box-shadow cutout and shows a callout with
 * the step copy and Back/Next/Skip.
 *
 * Robust by design: targets are located by attribute and the placement
 * recomputes on resize, so the highlight follows the live control position; a
 * target that is not on screen falls back to a centered callout rather than
 * dead-ending. Focus is trapped in the callout; Escape skips.
 */
export function CoachmarkTour(): React.ReactElement | null {
	const t = useTranslations('tour');
	const endTour = useMapStore((s: MapStoreState) => s.endTour);
	const [step, setStep] = useState(0);
	const [placement, setPlacement] = useState<Placement | null>(null);
	const calloutRef = usePopoverFocusTrap(true);

	const current = TOUR_STEPS[step];

	const locate = useCallback(() => {
		if (!current) return;
		const el = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`);
		const rect = el?.getBoundingClientRect();
		setPlacement(el && rect && rect.width > 0 && rect.height > 0 ? computePlacement(rect) : null);
	}, [current]);

	// Measure the target (and re-measure on resize) inside an animation frame, so
	// the placement update runs in a callback and reads layout after the controls
	// have settled rather than synchronously during the effect.
	useEffect(() => {
		let raf = requestAnimationFrame(locate);
		const onResize = (): void => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(locate);
		};
		window.addEventListener('resize', onResize);
		window.addEventListener('orientationchange', onResize);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('resize', onResize);
			window.removeEventListener('orientationchange', onResize);
		};
	}, [locate]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') endTour();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [endTour]);

	const goNext = useCallback(() => {
		if (step >= TOUR_STEPS.length - 1) {
			endTour();
		} else {
			setStep((s) => s + 1);
		}
	}, [step, endTour]);

	const goBack = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

	if (!current) return null;

	const isLast = step >= TOUR_STEPS.length - 1;
	const calloutStyle: React.CSSProperties = placement
		? { position: 'fixed', top: placement.callout.top, left: placement.callout.left }
		: { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

	return (
		<div className="pointer-events-none fixed inset-0 z-[var(--z-coachmark)]">
			{placement ? (
				// ring-cldt-blue is an intentional brand-accent spotlight (decorative,
				// aria-hidden), not a focus ring - hence not the usual cldt-green.
				<div
					aria-hidden="true"
					className="ring-cldt-blue fixed rounded-lg ring-2"
					style={{
						top: placement.spotlight.top,
						left: placement.spotlight.left,
						width: placement.spotlight.width,
						height: placement.spotlight.height,
						boxShadow: '0 0 0 9999px var(--color-scrim)',
					}}
				/>
			) : (
				<div aria-hidden="true" className="fixed inset-0" style={{ background: 'var(--color-scrim)' }} />
			)}
			<div
				aria-label={t('label')}
				className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3 text-gray-800 shadow-lg outline-none dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)] dark:text-[var(--text-primary)]"
				ref={calloutRef}
				role="dialog"
				style={{ ...calloutStyle, width: CALLOUT_WIDTH }}
			>
				<div aria-live="polite">
					<p className="m-0 text-sm font-semibold">{t(`steps.${current.key}.title`)}</p>
					<p className="m-0 mt-1 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
						{t(`steps.${current.key}.body`)}
					</p>
				</div>
				<div className="mt-1 flex items-center justify-between gap-2">
					<span aria-hidden="true" className="text-[0.625rem] text-gray-400 dark:text-[var(--text-secondary)]">
						{t('counter', { step: step + 1, total: TOUR_STEPS.length })}
					</span>
					<div className="flex items-center gap-1.5">
						<Button className="min-h-[var(--min-touch-target)] px-2" variant="bannerInline" onClick={endTour}>
							{t('skip')}
						</Button>
						{step > 0 && (
							<Button
								className="min-h-[var(--min-touch-target)]"
								size="sm"
								variant="mapControlOutlineSecondary"
								onClick={goBack}
							>
								{t('back')}
							</Button>
						)}
						<Button className="min-h-[var(--min-touch-target)]" size="sm" variant="mapControlOutline" onClick={goNext}>
							{isLast ? t('done') : t('next')}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
