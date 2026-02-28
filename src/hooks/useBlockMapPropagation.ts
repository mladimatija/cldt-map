'use client';

import { useEffect, type DependencyList, type RefObject } from 'react';
import L from 'leaflet';

/**
 * Prevents click and scroll events from propagating to the Leaflet map.
 * Use on overlay elements (buttons, sliders, chart) so the map doesn't
 * capture drag/zoom when the user interacts with them.
 * @param ref - Ref to the overlay element
 * @param deps - Optional deps to re-run when an element may have mounted later (e.g. [chartData.length] for conditionally rendered charts)
 */
export function useBlockMapPropagation(ref: RefObject<HTMLElement | null>, deps?: DependencyList): void {
	useEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		L.DomEvent.disableClickPropagation(el);
		L.DomEvent.disableScrollPropagation(el);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- optional deps are intentionally spread
	}, [ref, ...(deps ?? [])]);
}
