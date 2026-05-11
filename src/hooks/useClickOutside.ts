import { useEffect, type RefObject } from 'react';

/**
 * Closes a popover/panel when the user clicks anywhere outside the element
 * referenced by `containerRef`. Inactive (does nothing) when `isOpen` is false.
 *
 * Listens on `mousedown` so the close fires before any click handler inside the
 * page, which matches the behavior the popover patterns in this app expect.
 */
export function useClickOutside(
	containerRef: RefObject<HTMLElement | null>,
	isOpen: boolean,
	onClose: () => void,
): void {
	useEffect(() => {
		if (!isOpen) return;
		const handle = (e: MouseEvent): void => {
			const container = containerRef.current;
			if (container && !container.contains(e.target as Node)) {
				onClose();
			}
		};
		document.addEventListener('mousedown', handle);
		return () => document.removeEventListener('mousedown', handle);
	}, [containerRef, isOpen, onClose]);
}