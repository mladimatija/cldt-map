'use client';

import { useMemo } from 'react';
import { siteMetadata } from '@/lib/metadata';

/**
 * Hook to access site metadata throughout the application
 * Makes it easy to use consistent metadata across components
 */
export function useSiteMetadata(): typeof siteMetadata {
	return useMemo(() => siteMetadata, []);
}
