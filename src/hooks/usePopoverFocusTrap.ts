'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The focusable elements inside `el` right now. Sections that expand or
 *  collapse change the set, so it is read on every Tab press. */
function focusablesIn(el: HTMLElement): HTMLElement[] {
	return [...el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((node) => node.getClientRects().length > 0);
}

/**
 * Returns a ref to attach to a popover/dialog container. When `isOpen` is true:
 * - Focuses `initialFocusRef` when given, else the first focusable element inside the container.
 * - Traps Tab/Shift+Tab so focus stays within the container (for keyboard accessibility).
 * - On close, returns focus to the element that had it when the popover opened.
 */
export function usePopoverFocusTrap(
	isOpen: boolean,
	initialFocusRef?: RefObject<HTMLElement | null>,
): RefObject<HTMLDivElement | null> {
	const popoverRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!isOpen) return;
		const el = popoverRef.current;
		if (!el) return;

		const active = document.activeElement;
		const opener = active instanceof HTMLElement && active !== document.body ? active : null;
		(initialFocusRef?.current ?? focusablesIn(el)[0])?.focus();

		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key !== 'Tab') return;
			const focusables = focusablesIn(el);
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
				e.preventDefault();
				(e.shiftKey ? last : first).focus();
			}
		};
		el.addEventListener('keydown', handleKeyDown);
		return () => {
			el.removeEventListener('keydown', handleKeyDown);
			// Only when focus is still inside, or went away with the popover: a
			// close caused by clicking some other control keeps that control focused.
			const current = document.activeElement;
			const focusInside = !current || current === document.body || el.contains(current);
			if (focusInside && opener?.isConnected) opener.focus();
		};
	}, [isOpen, initialFocusRef]);

	return popoverRef;
}
