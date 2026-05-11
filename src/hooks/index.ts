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

export { useSiteMetadata, useMapStore, useBlockMapPropagation, useFitToRoute, usePopoverFocusTrap, useClickOutside };