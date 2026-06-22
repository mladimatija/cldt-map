'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { IoChevronBack, IoChevronForward, IoCloseOutline } from 'react-icons/io5';
import { Button } from '@/components/ui/Button';
// Import the focus-trap hook directly, not via the '@/hooks' barrel: the barrel
// re-exports Leaflet-importing hooks that would break this app-root component.
import { usePopoverFocusTrap } from '@/hooks/usePopoverFocusTrap';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { isSafeUrl } from '@/lib/utils';

/** Wrap-around index math kept in one place so the keyboard and pointer
 *  paths can't drift apart on a boundary-condition fix. */
function wrappedIndex(i: number, len: number): number {
	return i < 0 ? len - 1 : i >= len ? 0 : i;
}

function clamp(value: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, value));
}

function pointerDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
/** Min horizontal travel (px) of a one-finger touch to count as a prev/next swipe. */
const SWIPE_THRESHOLD = 50;
/** Max gap (ms) between two taps to register a double-tap zoom toggle. */
const DOUBLE_TAP_MS = 300;

/**
 * Image lightbox for the POI gallery. Mounted at the app root; inactive
 * (renders nothing) until `lightboxImages` is set in the store - a thumbnail
 * click in the popup gallery triggers `openLightbox(images, i)`.
 *
 * The photo sits in a centred card (popout chrome, not a full-bleed overlay)
 * on the shared modal backdrop, so the attribution / license / source row
 * below the image stays visible. Touch: pinch to zoom, drag to pan when
 * zoomed, swipe left/right to change image, double-tap to toggle zoom.
 *
 * Keyboard: Escape closes; ArrowLeft/Right step (wrapping); Home/End jump.
 * Body scroll is locked while open so the page can't shift underneath.
 */
export function PoiImageLightbox(): React.ReactElement | null {
	const t = useTranslations('pois');
	const images = useMapStore((s: MapStoreState) => s.lightboxImages);
	const index = useMapStore((s: MapStoreState) => s.lightboxIndex);
	const close = useMapStore((s: MapStoreState) => s.closeLightbox);
	const setIndex = useMapStore((s: MapStoreState) => s.setLightboxIndex);

	// Trap keyboard focus inside the dialog (and focus a control on open) so Tab
	// can't leak to the map controls behind the backdrop, and arrow keys can't
	// reach the Leaflet map underneath.
	const cardRef = usePopoverFocusTrap(Boolean(images && images.length > 0));
	const viewportRef = useRef<HTMLDivElement>(null);

	// Zoom / pan state. Reset whenever the visible image changes.
	const [scale, setScale] = useState(1);
	const [offset, setOffset] = useState({ x: 0, y: 0 });
	const [dragging, setDragging] = useState(false);
	const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
	const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
	const dragStart = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean; touch: boolean } | null>(
		null,
	);
	const lastTapAt = useRef(0);
	// Tracks which (image, gallery) the zoom/pan state belongs to, so it can be
	// reset during render when the visible image changes (see below).
	const [shownFor, setShownFor] = useState({ index, images });

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

	// New image (or freshly opened): drop any zoom / pan from the previous one.
	// Adjusted during render instead of in an effect to avoid a cascading
	// re-render (https://react.dev/learn/you-might-not-need-an-effect).
	if (shownFor.index !== index || shownFor.images !== images) {
		setShownFor({ index, images });
		setScale(1);
		setOffset({ x: 0, y: 0 });
	}

	if (!images || images.length === 0) return null;
	const current = images[index];
	if (!current) return null;
	const src = current.url && isSafeUrl(current.url) ? current.url : '';
	const total = images.length;

	const goPrev = (): void => setIndex(wrappedIndex(index - 1, total));
	const goNext = (): void => setIndex(wrappedIndex(index + 1, total));

	// Keep a zoomed image from being dragged entirely out of view. Bounds are
	// derived from the viewport box (which hugs the rendered image), so this is
	// a close-enough soft clamp without measuring the image's own dimensions.
	const clampOffset = (o: { x: number; y: number }, s: number): { x: number; y: number } => {
		const el = viewportRef.current;
		if (!el) return o;
		const maxX = ((s - 1) * el.clientWidth) / 2;
		const maxY = ((s - 1) * el.clientHeight) / 2;
		return { x: clamp(o.x, -maxX, maxX), y: clamp(o.y, -maxY, maxY) };
	};

	const onPointerDown = (e: React.PointerEvent): void => {
		// Let the prev/next/close buttons handle their own clicks: capturing the
		// pointer here would swallow the click that the controls rely on.
		if ((e.target as HTMLElement).closest('button')) return;
		viewportRef.current?.setPointerCapture?.(e.pointerId);
		activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (activePointers.current.size === 2) {
			const [a, b] = [...activePointers.current.values()];
			pinchStart.current = { dist: pointerDistance(a, b), scale };
			dragStart.current = null;
		} else if (activePointers.current.size === 1) {
			dragStart.current = {
				x: e.clientX,
				y: e.clientY,
				ox: offset.x,
				oy: offset.y,
				moved: false,
				touch: e.pointerType === 'touch',
			};
			setDragging(true);
		}
	};

	const onPointerMove = (e: React.PointerEvent): void => {
		if (!activePointers.current.has(e.pointerId)) return;
		activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pinchStart.current && activePointers.current.size === 2) {
			const [a, b] = [...activePointers.current.values()];
			const nextScale = clamp(
				pinchStart.current.scale * (pointerDistance(a, b) / pinchStart.current.dist),
				1,
				MAX_SCALE,
			);
			setScale(nextScale);
			if (nextScale === 1) setOffset({ x: 0, y: 0 });
		} else if (dragStart.current && activePointers.current.size === 1) {
			const dx = e.clientX - dragStart.current.x;
			const dy = e.clientY - dragStart.current.y;
			if (Math.abs(dx) > 6 || Math.abs(dy) > 6) dragStart.current.moved = true;
			if (scale > 1) setOffset(clampOffset({ x: dragStart.current.ox + dx, y: dragStart.current.oy + dy }, scale));
		}
	};

	const onPointerEnd = (e: React.PointerEvent): void => {
		const start = dragStart.current;
		activePointers.current.delete(e.pointerId);
		if (activePointers.current.size < 2) pinchStart.current = null;
		if (activePointers.current.size > 0) return;
		setDragging(false);
		dragStart.current = null;
		if (!start || scale > 1) return;
		const dx = e.clientX - start.x;
		const dy = e.clientY - start.y;
		// Horizontal one-finger swipe steps between images (touch only - a mouse
		// drag should never navigate; the arrows / keys cover pointer users).
		if (total > 1 && start.touch && Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
			if (dx < 0) goNext();
			else goPrev();
			return;
		}
		// A tap that didn't move: double-tap toggles zoom in / out.
		if (!start.moved) {
			const now = Date.now();
			if (now - lastTapAt.current < DOUBLE_TAP_MS) {
				setScale((s) => (s > 1 ? 1 : DOUBLE_TAP_SCALE));
				setOffset({ x: 0, y: 0 });
				lastTapAt.current = 0;
			} else {
				lastTapAt.current = now;
			}
		}
	};

	return (
		<div
			aria-label={t('lightboxAriaLabel')}
			aria-modal="true"
			className="poi-lightbox fixed inset-0 flex items-center justify-center bg-[var(--modal-backdrop-bg)] p-4"
			role="dialog"
			onClick={close}
		>
			{/* Card - popout chrome sized to the photo (capped), with the
			    attribution row always visible below it. */}
			<div
				className="relative flex max-w-[min(92vw,1100px)] flex-col gap-2 rounded-[var(--map-tooltip-radius)] bg-[var(--map-tooltip-bg)] p-2 shadow-xl"
				ref={cardRef}
				onClick={(e) => e.stopPropagation()}
			>
				<div
					className="relative flex touch-none items-center justify-center overflow-hidden rounded"
					ref={viewportRef}
					style={{ cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'auto' }}
					onPointerCancel={onPointerEnd}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerEnd}
				>
					{src && (
						// next/image would need every Commons mirror domain whitelisted
						// in next.config and an extra hop through the image optimiser;
						// the lightbox shows full-resolution Commons originals at unknown
						// dimensions, so a raw <img> is the right fit. Pointer events go
						// to the viewport wrapper, so the image itself ignores them.
						// eslint-disable-next-line @next/next/no-img-element
						<img
							alt={current.attribution ?? ''}
							className="poi-lightbox__img max-h-[78vh] max-w-[min(88vw,1080px)] select-none"
							draggable={false}
							src={src}
							style={{
								pointerEvents: 'none',
								transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
								transition: dragging ? 'none' : 'transform 200ms ease-out',
								willChange: 'transform',
							}}
						/>
					)}

					{/* Prev / next - the app's round map-control button so they read
					    over any photo. Only shown with more than one image. */}
					{total > 1 && (
						<>
							<Button
								aria-label={t('lightboxPrev')}
								className="absolute top-1/2 left-2 -translate-y-1/2"
								variant="controlRoundDark"
								onClick={(e) => {
									e.stopPropagation();
									goPrev();
								}}
							>
								<IoChevronBack aria-hidden className="h-5 w-5" />
							</Button>
							<Button
								aria-label={t('lightboxNext')}
								className="absolute top-1/2 right-2 -translate-y-1/2"
								variant="controlRoundDark"
								onClick={(e) => {
									e.stopPropagation();
									goNext();
								}}
							>
								<IoChevronForward aria-hidden className="h-5 w-5" />
							</Button>
						</>
					)}
				</div>

				{/* Attribution + counter - always visible on the card, below the photo. */}
				<div className="flex shrink-0 items-center justify-between gap-3 px-1 pb-0.5 text-xs text-gray-600 dark:text-[var(--text-secondary)]">
					<div className="min-w-0 flex-1 break-words">
						{current.attribution && <span>{current.attribution}</span>}
						{current.license && <span className="ml-2 opacity-70">· {current.license}</span>}
						{current.sourceUrl && isSafeUrl(current.sourceUrl) && (
							<>
								{' · '}
								<a
									aria-label={`${t('lightboxSource')}: ${current.attribution ?? current.sourceUrl}`}
									className="text-cldt-blue hover:text-cldt-green underline"
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
						{index + 1} / {total}
					</div>
				</div>

				{/* Close - the app's round map-control button, anchored to the
				    card's top-right corner. */}
				<Button
					aria-label={t('lightboxClose')}
					className="absolute top-2 right-2"
					variant="controlRoundDark"
					onClick={(e) => {
						e.stopPropagation();
						close();
					}}
				>
					<IoCloseOutline aria-hidden className="h-5 w-5" />
				</Button>
			</div>
		</div>
	);
}
