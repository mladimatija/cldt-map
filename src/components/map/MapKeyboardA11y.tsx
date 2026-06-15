'use client';

/**
 * Makes the Leaflet map a labelled, keyboard-discoverable region for screen
 * readers. react-leaflet does not forward arbitrary aria-/role/tabindex props
 * to the container, so they are set imperatively on the container element.
 * Leaflet's built-in keyboard handler already pans (arrows) and zooms (+/-)
 * once the container is focused; this adds the label + instructions + a one-time
 * orientation announcement on focus. Renders only the sr-only instructions node.
 */
import React, { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';

const INSTRUCTIONS_ID = 'map-keyboard-instructions';

export default function MapKeyboardA11y(): React.ReactElement {
	const t = useTranslations('a11y');
	const map = useMap();
	const announce = useMapStore((state: MapStoreState) => state.announce);

	useEffect(() => {
		const container = map.getContainer();
		container.setAttribute('role', 'region');
		container.setAttribute('aria-label', t('mapLabel'));
		container.setAttribute('aria-describedby', INSTRUCTIONS_ID);
		if (!container.hasAttribute('tabindex')) {
			container.setAttribute('tabindex', '0');
		}
		// Announce orientation once per focus visit (reset on blur) so a screen
		// reader user learns the controls without it repeating on every keypress.
		let announced = false;
		const onFocus = (): void => {
			if (announced) return;
			announced = true;
			announce(t('mapOrientation'));
		};
		const onBlur = (): void => {
			announced = false;
		};
		container.addEventListener('focus', onFocus);
		container.addEventListener('blur', onBlur);
		return () => {
			container.removeEventListener('focus', onFocus);
			container.removeEventListener('blur', onBlur);
		};
	}, [map, t, announce]);

	return (
		<div className="sr-only" id={INSTRUCTIONS_ID}>
			{t('mapInstructions')}
		</div>
	);
}
