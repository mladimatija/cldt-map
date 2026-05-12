import { useEffect, useRef, type RefObject } from 'react';

/**
 * Closes a popover/panel when the user clicks anywhere outside the element
 * referenced by `containerRef`. Inactive (does nothing) when `isOpen` is false.
 *
 * Listens on `mousedown` so the close fires before any click handler inside the
 * page, which matches the behavior the popover patterns in this app expect.
 *
 * `onClose` is read through a ref so inline arrow callbacks at the call site
 * don't tear down and re-add the document listener on every render.
 */
export function useClickOutside(
	containerRef: RefObject<HTMLElement | null>,
	isOpen: boolean,
	onClose: () => void,
): void {
	const onCloseRef = useRef(onClose);
	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);

	useEffect(() => {
		if (!isOpen) return;
		const handle = (e: MouseEvent): void => {
			const container = containerRef.current;
			if (container && !container.contains(e.target as Node)) {
				onCloseRef.current();
			}
		};
		document.addEventListener('mousedown', handle);
		return () => document.removeEventListener('mousedown', handle);
		// onClose intentionally omitted - read via onCloseRef so inline-arrow callers
		// don't trigger listener teardown/re-attach on every render.
	}, [containerRef, isOpen]);
}
