'use client';

import React, { useEffect } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';

/**
 * Applies theme preferences (dark mode, large touch targets) to the document.
 * Must be a client component to access the store.
 */
export default function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactNode {
	const darkMode = useMapStore((state: MapStoreState) => state.darkMode);
	const largeTouchTargets = useMapStore((state: MapStoreState) => state.largeTouchTargets);

	useEffect(() => {
		const root = document.documentElement;
		if (darkMode) {
			root.classList.add('dark');
		} else {
			root.classList.remove('dark');
		}
	}, [darkMode]);

	useEffect(() => {
		const root = document.documentElement;
		if (largeTouchTargets) {
			root.classList.add('large-touch-targets');
		} else {
			root.classList.remove('large-touch-targets');
		}
	}, [largeTouchTargets]);

	return children;
}
