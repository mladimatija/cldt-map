'use client';

import { useCallback, useEffect, useRef } from 'react';

interface EscapeLayer {
	onEscape: () => void;
	/** A dialog: the layers below it ignore clicks outside themselves while it is open. */
	modal: boolean;
	/** A map mode (the ruler): any open panel, dialog or menu takes Escape first. */
	mode: boolean;
}

/** Open layers in the order they opened. */
const layers: EscapeLayer[] = [];

/** Controls that handle Escape themselves: an open combobox list (react-select)
 *  closes the list, and a field marked `data-handles-escape` runs its own handler. */
const OWN_ESCAPE_SELECTOR = '[role="combobox"][aria-expanded="true"], [data-handles-escape]';

/** The layer Escape closes: the last opened overlay, else the last map mode. */
function topLayer(): EscapeLayer | undefined {
	for (let i = layers.length - 1; i >= 0; i--) {
		if (!layers[i].mode) return layers[i];
	}
	return layers[layers.length - 1];
}

/** Runs in the capture phase, before any control inside a layer sees the key. */
function handleKeydown(e: KeyboardEvent): void {
	// During IME composition, Escape cancels the composition only.
	if (e.key !== 'Escape' || e.isComposing) return;
	if (e.target instanceof Element && e.target.closest(OWN_ESCAPE_SELECTOR)) return;
	topLayer()?.onEscape();
}

interface EscapeLayerHandle {
	/** True while a dialog opened after this layer is still open. */
	hasModalAbove: () => boolean;
}

/**
 * Registers an open overlay (panel, dialog, menu) or map mode so Escape closes
 * only the one opened last: a dialog opened from a panel closes on its own and
 * the panel stays. Every Escape handler in the app goes through here, except
 * fields marked `data-handles-escape`; a separate document or React listener
 * would run in addition to the stack. Leaflet-free, so it is safe in modules
 * reachable during SSR.
 *
 * `active` is truthy while the layer is open. A different truthy value
 * registers it again on top, as when one panel replaces another.
 */
export function useEscapeLayer(
	active: boolean | string | null,
	onEscape: () => void,
	{ modal = false, mode = false }: { modal?: boolean; mode?: boolean } = {},
): EscapeLayerHandle {
	// The latest callback, so a re-render does not register the layer again and
	// move it to the top of the stack.
	const onEscapeRef = useRef(onEscape);
	useEffect(() => {
		onEscapeRef.current = onEscape;
	});
	const layerRef = useRef<EscapeLayer | null>(null);

	useEffect(() => {
		if (!active) return;
		const layer: EscapeLayer = { onEscape: () => onEscapeRef.current(), modal, mode };
		layers.push(layer);
		layerRef.current = layer;
		if (layers.length === 1) document.addEventListener('keydown', handleKeydown, true);
		return () => {
			layers.splice(layers.indexOf(layer), 1);
			if (layerRef.current === layer) layerRef.current = null;
			if (layers.length === 0) document.removeEventListener('keydown', handleKeydown, true);
		};
	}, [active, modal, mode]);

	const hasModalAbove = useCallback((): boolean => {
		const own = layerRef.current;
		if (!own) return false;
		return layers.slice(layers.indexOf(own) + 1).some((layer) => layer.modal);
	}, []);

	return { hasModalAbove };
}
