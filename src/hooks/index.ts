/**
 * Central export point for app hooks (map store, block map propagation, site metadata).
 * Import from here for a single entry point; store hooks are also re-exported.
 */

import { useMapStore } from '@/lib/store';
import { useBlockMapPropagation } from './useBlockMapPropagation';
import { useSiteMetadata } from './useSiteMetadata';
import { useFitToRoute } from './useFitToRoute';
import { usePopoverFocusTrap } from './usePopoverFocusTrap';
import { useClickOutside } from './useClickOutside';
import { usePanel, usePanelListeners, usePanelManager } from './usePanelManager';
import { usePoiListRows } from './usePoiListRows';
import { useRuler } from './useRuler';

export {
	useSiteMetadata,
	useMapStore,
	useBlockMapPropagation,
	useFitToRoute,
	usePopoverFocusTrap,
	useClickOutside,
	usePanel,
	usePanelListeners,
	usePanelManager,
	usePoiListRows,
	useRuler,
};
export type { UseRulerResult } from './useRuler';
export type {
	ParsedDistance,
	PoiListGroupedItem,
	SortMode,
	UsePoiListRowsArgs,
	UsePoiListRowsResult,
} from './usePoiListRows';
