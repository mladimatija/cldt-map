'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Returns a ref to attach to a popover/dialog container. When `isOpen` is true:
 * - Focuses the first focusable element inside the container.
 * - Traps Tab/Shift+Tab so focus stays within the container (for keyboard accessibility).
 */
export function usePopoverFocusTrap(isOpen: boolean): RefObject<HTMLDivElement | null> {
	const popoverRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!isOpen) return;
		const el = popoverRef.current;
		if (!el) return;

		const focusables = el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		first?.focus();

		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key !== 'Tab') return;
			if (focusables.length === 0) return;
			if (e.shiftKey) {
				if (document.activeElement === first) {
					e.preventDefault();
					last?.focus();
				}
			} else {
				if (document.activeElement === last) {
					e.preventDefault();
					first?.focus();
				}
			}
		};
		el.addEventListener('keydown', handleKeyDown);
		return () => el.removeEventListener('keydown', handleKeyDown);
	}, [isOpen]);

	return popoverRef;
}
