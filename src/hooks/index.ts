/**
 * Central export point for app hooks (map service, map store, block map propagation, site metadata).
 * Import from here for a single entry point; store hooks are also re-exported.
 */

// Map service and persisted map store
import { useMapService } from './useMapService';
import { useMapStore } from '@/lib/store';

// Map overlay - block event propagation to map
import { useBlockMapPropagation } from './useBlockMapPropagation';

// Site metadata
import { useSiteMetadata } from './useSiteMetadata';

import { useFitToRoute } from './useFitToRoute';

// Export all hooks
export { useMapService, useSiteMetadata, useMapStore, useBlockMapPropagation, useFitToRoute };
