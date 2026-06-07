'use client';

import React, { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { cn, isSafeUrl } from '@/lib/utils';

/** Wrap-around index math kept in one place so the keyboard and pointer
 *  paths can't drift apart on a boundary-condition fix. */
function wrappedIndex(i: number, len: number): number {
	return i < 0 ? len - 1 : i >= len ? 0 : i;
}

/**
 * Fullscreen lightbox for the POI image gallery. Mounted at the app root.
 * Inactive (renders nothing) until `lightboxImages` is set in the store -
 * a thumbnail click in the popup gallery triggers `openLightbox(images, i)`.
 *
 * Keyboard:
 *   - Escape: close
 *   - ArrowLeft / ArrowRight: prev / next image (wraps at the ends)
 *   - Home / End: jump to first / last
 *
 * The body's overflow is locked while the lightbox is open so background
 * scrolling can't shift content underneath the overlay.
 */
export function PoiImageLightbox(): React.ReactElement | null {
	const t = useTranslations('pois');
	const images = useMapStore((s: MapStoreState) => s.lightboxImages);
	const index = useMapStore((s: MapStoreState) => s.lightboxIndex);
	const close = useMapStore((s: MapStoreState) => s.closeLightbox);
	const setIndex = useMapStore((s: MapStoreState) => s.setLightboxIndex);

	// All hooks are declared here, above any early returns, to satisfy
	// React's Rules of Hooks (hook call count must be stable on every render).
	const overlayRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!images) return;
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				e.preventDefault();
				close();
			} else if (e.key === 'ArrowLeft') {
				e.preventDefault();
				setIndex(wrappedIndex(index - 1, images.length));
			} else if (e.key === 'ArrowRight') {
				e.preventDefault();
				setIndex(wrappedIndex(index + 1, images.length));
			} else if (e.key === 'Home') {
				e.preventDefault();
				setIndex(0);
			} else if (e.key === 'End') {
				e.preventDefault();
				setIndex(images.length - 1);
			}
		};
		document.addEventListener('keydown', onKey);
		// Lock body scroll so the page underneath doesn't jiggle.
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.removeEventListener('keydown', onKey);
			document.body.style.overflow = previousOverflow;
		};
	}, [images, index, close, setIndex]);

	// Programmatic focus on open - `autoFocus` is not reliable across all
	// browsers for non-input elements; a useRef + useEffect guarantees focus
	// lands on the overlay so keyboard events are captured immediately.
	useEffect(() => {
		overlayRef.current?.focus();
	}, [images]);

	if (!images || images.length === 0) return null;
	const current = images[index];
	if (!current) return null;
	const src = current.url && isSafeUrl(current.url) ? current.url : '';

	const prev = (): void => setIndex(wrappedIndex(index - 1, images.length));
	const next = (): void => setIndex(wrappedIndex(index + 1, images.length));

	return (
		<div
			aria-label={t('lightboxAriaLabel')}
			aria-modal="true"
			className="poi-lightbox fixed inset-0 flex flex-col items-center justify-center bg-[var(--lightbox-backdrop-bg)] p-4"
			ref={overlayRef}
			role="dialog"
			tabIndex={-1}
			onClick={close}
		>
			{/* Image - clicking the image itself doesn't dismiss (would be jarring
			    on mobile where any tap closes the lightbox). Only the surrounding
			    backdrop dismisses. */}
			{src && (
				// next/image would need every Commons mirror domain whitelisted
				// in next.config and would issue an extra hop through the Next
				// image optimiser. The lightbox shows full-resolution Commons
				// originals at unknown dimensions, so a raw <img> is the right
				// fit here. The same lint rule is already suppressed for the
				// popup gallery's <img> for the same reason.
				// eslint-disable-next-line @next/next/no-img-element
				<img
					alt={current.attribution ?? ''}
					className="poi-lightbox__img max-h-full max-w-full object-contain"
					src={src}
					onClick={(e) => e.stopPropagation()}
				/>
			)}

			{/* Attribution + counter row, anchored at the bottom. */}
			<div
				className="mt-3 flex w-full max-w-3xl items-center justify-between gap-3 text-xs text-[var(--lightbox-text-secondary)]"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="min-w-0 flex-1">
					{current.attribution && <span>{current.attribution}</span>}
					{current.license && <span className="ml-2 opacity-70">· {current.license}</span>}
					{current.sourceUrl && isSafeUrl(current.sourceUrl) && (
						<>
							{' · '}
							<a
								aria-label={`${t('lightboxSource')}: ${current.attribution ?? current.sourceUrl}`}
								className="underline hover:text-[var(--lightbox-text-primary)]"
								href={current.sourceUrl}
								rel="noopener noreferrer"
								target="_blank"
							>
								{t('lightboxSource')}
							</a>
						</>
					)}
				</div>
				<div className="shrink-0 tabular-nums">
					{index + 1} / {images.length}
				</div>
			</div>

			{/* Prev / next, only when there's more than one image. Big tap
			    targets for mobile; click-events stop the backdrop dismiss. */}
			{images.length > 1 && (
				<>
					<button
						aria-label={t('lightboxPrev')}
						className={cn(
							'poi-lightbox__nav absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-[var(--lightbox-chrome-bg)] p-3 text-[var(--lightbox-text-primary)] hover:bg-[var(--lightbox-chrome-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lightbox-text-primary)]',
						)}
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							prev();
						}}
					>
						<span aria-hidden>‹</span>
					</button>
					<button
						aria-label={t('lightboxNext')}
						className={cn(
							'poi-lightbox__nav absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-[var(--lightbox-chrome-bg)] p-3 text-[var(--lightbox-text-primary)] hover:bg-[var(--lightbox-chrome-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lightbox-text-primary)]',
						)}
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							next();
						}}
					>
						<span aria-hidden>›</span>
					</button>
				</>
			)}

			{/* Close button, always visible top-right. */}
			<button
				aria-label={t('lightboxClose')}
				className="absolute top-3 right-3 rounded-full bg-[var(--lightbox-chrome-bg)] p-2 text-[var(--lightbox-text-primary)] hover:bg-[var(--lightbox-chrome-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lightbox-text-primary)]"
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					close();
				}}
			>
				<span aria-hidden>✕</span>
			</button>
		</div>
	);
}
