/**
 * Central export point for app hooks (map store, block map propagation, site metadata).
 * Import from here for a single entry point; store hooks are also re-exported.
 *
 * CLIENT-ONLY: this barrel re-exports useRuler and useBlockMapPropagation, which
 * import Leaflet at module top level (Leaflet touches `window` on evaluation). Do
 * not import this barrel from server components or any module reachable during SSR
 * (a 'use client' directive does not prevent server-side module evaluation). Such
 * modules should import the specific leaflet-free hook directly, e.g.
 * `import { usePopoverFocusTrap } from '@/hooks/usePopoverFocusTrap'`.
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
import { usePackAdjustedPaceKmh, packAdjustedPaceKmhFromState } from './usePackAdjustedPace';
import { useActiveStarredPoiIds } from './useActiveStarredPoiIds';
import { useAnimatedNumber } from './useAnimatedNumber';
import { useTrailSunWeather } from './useTrailSunWeather';

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
	usePackAdjustedPaceKmh,
	packAdjustedPaceKmhFromState,
	useActiveStarredPoiIds,
	useAnimatedNumber,
	useTrailSunWeather,
};
export type { UseRulerResult } from './useRuler';
export type { TrailSunWeather } from './useTrailSunWeather';
export type {
	ParsedDistance,
	PoiListGroupedItem,
	SortMode,
	UsePoiListRowsArgs,
	UsePoiListRowsResult,
} from './usePoiListRows';
