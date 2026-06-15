'use client';

import React, { useEffect } from 'react';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { UI_TEXT_SCALES, uiTextScaleClass } from '@/lib/ui-text-scale';

/**
 * Applies theme preferences (dark mode, large touch targets, UI text size) to
 * the document. Must be a client component to access the store.
 */
export default function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactNode {
	const darkMode = useMapStore((state: MapStoreState) => state.darkMode);
	const largeTouchTargets = useMapStore((state: MapStoreState) => state.largeTouchTargets);
	const uiTextScale = useMapStore((state: MapStoreState) => state.uiTextScale);

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

	useEffect(() => {
		const root = document.documentElement;
		// Clear any prior scale class, then apply the active one (default = none).
		for (const scale of UI_TEXT_SCALES) {
			const cls = uiTextScaleClass(scale);
			if (cls) root.classList.remove(cls);
		}
		const active = uiTextScaleClass(uiTextScale);
		if (active) root.classList.add(active);
	}, [uiTextScale]);

	return children;
}
