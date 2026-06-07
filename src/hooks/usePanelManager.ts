'use client';

import { useCallback, useEffect, type RefObject } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';

/**
 * Module-level registry of panel container refs. Lives outside React state
 * because refs aren't useful as serializable store data, but the shared
 * `openPanel` flag in `useMapStore` still owns the actual mutual-exclusion
 * state. The document-level listeners installed by `usePanelListeners` read
 * from this map when a panel is open to decide whether a click was "outside".
 *
 * Note on HMR: Stale ref entries are cleaned up
 * by `usePanel`'s effect cleanup (`panelRefs.delete(id)`), so the registry
 * stays consistent across re-renders without needing a hot-reload reset.
 */
const panelRefs = new Map<string, RefObject<HTMLElement | null>>();

interface RawPanelStore {
	openPanel: string | null;
	setOpenPanel: (id: string | null) => void;
	togglePanel: (id: string) => void;
	closePanel: () => void;
}

/** Select all four panel slices from the map store in one place so the two
 *  public hooks (`usePanelManager`, `usePanel`) */
function useRawPanelStore(): RawPanelStore {
	const openPanel = useMapStore((s: MapStoreState) => s.openPanel);
	const setOpenPanel = useMapStore((s: MapStoreState) => s.setOpenPanel);
	const togglePanel = useMapStore((s: MapStoreState) => s.togglePanel);
	const closePanel = useMapStore((s: MapStoreState) => s.closePanel);
	return { openPanel, setOpenPanel, togglePanel, closePanel };
}

interface PanelManagerApi {
	openPanel: string | null;
	isOpen: (id: string) => boolean;
	/** Open `id`. If another panel is open, it is closed automatically. */
	open: (id: string) => void;
	/** Toggle `id`. If already open, closes it; otherwise opens (replacing
	 *  any other open panel). */
	toggle: (id: string) => void;
	/** Close whichever panel is open. */
	close: () => void;
}

/** Read the shared panel manager helpers, backed by the map store. Use this
 *  for cross-panel actions (e.g. closing whatever is open when a map mode
 *  toggle fires). For per-panel registration prefer `usePanel`. */
export function usePanelManager(): PanelManagerApi {
	const { openPanel, setOpenPanel, togglePanel, closePanel } = useRawPanelStore();

	const isOpen = useCallback((id: string): boolean => openPanel === id, [openPanel]);
	const open = useCallback((id: string): void => setOpenPanel(id), [setOpenPanel]);
	const toggle = useCallback((id: string): void => togglePanel(id), [togglePanel]);

	return { openPanel, isOpen, open, toggle, close: closePanel };
}

interface PanelHandle {
	isOpen: boolean;
	open: () => void;
	close: () => void;
	toggle: () => void;
}

/**
 * Register a panel's container ref with the shared manager and get scoped
 * open/close/toggle helpers for this panel id. Use from any component that
 * renders a popover-style panel so its open/close stays coordinated with the
 * rest of the panel group.
 */
export function usePanel(id: string, ref: RefObject<HTMLElement | null>): PanelHandle {
	const { openPanel, setOpenPanel, togglePanel, closePanel } = useRawPanelStore();

	useEffect(() => {
		panelRefs.set(id, ref);
		return () => {
			if (panelRefs.get(id) === ref) panelRefs.delete(id);
		};
	}, [id, ref]);

	const open = useCallback((): void => setOpenPanel(id), [id, setOpenPanel]);
	const toggle = useCallback((): void => togglePanel(id), [id, togglePanel]);

	return { isOpen: openPanel === id, open, close: closePanel, toggle };
}

/**
 * Install document-level listeners that close the currently open panel on
 * outside `mousedown` or `Escape`. Call once from a component that's mounted
 * for as long as any panel could be open (e.g. MapContent).
 */
export function usePanelListeners(): void {
	const openPanel = useMapStore((s: MapStoreState) => s.openPanel);
	const closePanel = useMapStore((s: MapStoreState) => s.closePanel);

	useEffect(() => {
		if (!openPanel) return;
		const handleMousedown = (e: MouseEvent): void => {
			const ref = panelRefs.get(openPanel);
			if (ref?.current && !ref.current.contains(e.target as Node)) {
				closePanel();
			}
		};
		const handleKeydown = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') closePanel();
		};
		document.addEventListener('mousedown', handleMousedown);
		document.addEventListener('keydown', handleKeydown);
		return () => {
			document.removeEventListener('mousedown', handleMousedown);
			document.removeEventListener('keydown', handleKeydown);
		};
	}, [openPanel, closePanel]);
}
