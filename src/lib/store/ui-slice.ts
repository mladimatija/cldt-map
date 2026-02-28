import type { StateCreator } from 'zustand';
import { config } from '../config';
import type { StoreState, UISlice } from './types';

export const createUISlice: StateCreator<StoreState, [], [], UISlice> = (set) => ({
	showBoundary: config.showBoundary,
	showTileBoundary: config.showTileBoundary,
	units: config.units,
	mapMountTime: null,

	setShowBoundary: (show) => set({ showBoundary: show }),
	setShowTileBoundary: (show) => set({ showTileBoundary: show }),
	setUnits: (units) => set({ units }),
	setMapMountTime: (time) => set({ mapMountTime: time }),

	broadcastUnitsChange: (newUnits): void => {
		set({ units: newUnits });

		const event = new CustomEvent('unitsChange', {
			detail: { units: newUnits },
		});
		window.dispatchEvent(event);
	},
});
