'use client';

/**
 * The base map tile layer: the selected style, clipped to Croatia while tile
 * clipping is on (the default). The one owner of the base tile pane, keyed on
 * the style and the clipping flag, so each change builds exactly one layer.
 */
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import type L from 'leaflet';
import {
	canClipBaseMap,
	createBaseMapLayer,
	createClippedBaseMapLayer,
	loadBaseMapClip,
	replaceBaseLayer,
} from '@/lib/services/base-map-layer';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { selectedBaseMapProvider } from './base-map-options';

/** A clip still loading after this long shows the plain layer meanwhile, so a
 *  slow outline never leaves the map without tiles. */
const CLIP_WAIT_MS = 2000;
/** A failed clip load is retried after these delays, with the plain layer shown
 *  in between; after the last one the plain layer stays for this page view. The
 *  setting is left alone: a failed download is not a preference. */
const CLIP_RETRY_DELAYS_MS = [2000, 5000, 15000];

export default function BaseMapLayer(): null {
	const map = useMap();
	const storedProvider = useMapStore((state: MapStoreState) => state.baseMapProvider);
	const showTileBoundary = useMapStore((state: MapStoreState) => state.showTileBoundary);
	const provider = selectedBaseMapProvider(storedProvider);
	const clip = showTileBoundary && canClipBaseMap(provider);
	const layerRef = useRef<L.TileLayer | null>(null);
	/** Style and clipping the layer on the map was built for. */
	const shownKeyRef = useRef<string | null>(null);

	useEffect(() => {
		const key = `${provider}|${clip}`;
		// Already on the map, e.g. a repeated effect run: rebuilding would refetch every tile.
		if (shownKeyRef.current === key) return;
		let cancelled = false;
		const show = (layer: L.TileLayer, shownKey: string): void => {
			map.whenReady(() => {
				if (cancelled) return;
				try {
					replaceBaseLayer(map, layer);
					layerRef.current = layer;
					shownKeyRef.current = shownKey;
				} catch (error) {
					console.error('Error setting map layer:', error);
				}
			});
		};
		const plainKey = `${provider}|false`;
		const showPlain = (): void => {
			if (shownKeyRef.current !== plainKey) show(createBaseMapLayer(provider), plainKey);
		};

		if (!clip) {
			showPlain();
			return () => {
				cancelled = true;
			};
		}

		// Clipped from the start: drawing the plain layer first downloaded the view
		// twice and showed unclipped tiles until the copy replaced it.
		const fallbackTimer = setTimeout(showPlain, CLIP_WAIT_MS);
		let retryTimer: ReturnType<typeof setTimeout> | null = null;
		const tryClip = (attempt: number): void => {
			loadBaseMapClip()
				.then((boundary) => {
					clearTimeout(fallbackTimer);
					if (cancelled) return;
					const clipped = createClippedBaseMapLayer(provider, boundary);
					if (clipped) show(clipped, key);
					else showPlain();
				})
				.catch((error: unknown) => {
					clearTimeout(fallbackTimer);
					if (cancelled) return;
					console.error('Error loading tile clipping:', error);
					showPlain();
					const delay = CLIP_RETRY_DELAYS_MS[attempt];
					if (delay !== undefined) retryTimer = setTimeout(() => tryClip(attempt + 1), delay);
				});
		};
		tryClip(0);
		return () => {
			cancelled = true;
			clearTimeout(fallbackTimer);
			if (retryTimer) clearTimeout(retryTimer);
		};
	}, [map, provider, clip]);

	// A style or clipping change keeps the current tiles until the next layer
	// replaces them; the layer itself goes only with this component.
	useEffect(
		() => () => {
			layerRef.current?.remove();
			layerRef.current = null;
			shownKeyRef.current = null;
		},
		[],
	);

	return null;
}
