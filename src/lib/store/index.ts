import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import type { StoreState, MapStoreState } from './types';
import { createLocationSlice } from './location-slice';
import { createTrailSlice } from './trail-slice';
import { createMapStore, createMapStoreState } from './map-store';

export type { StoreState, MapStoreState };
export type {
	LocationState,
	LocationActions,
	LocationSlice,
	ClosestPoint,
	EnhancedTrailPoint,
	TrailMetadata,
	TrailState,
	TrailActions,
	TrailSlice,
	TrailDirection,
	UnitSystem,
} from './types';

type MainStore = UseBoundStore<StoreApi<StoreState>>;
type MapStore = UseBoundStore<StoreApi<MapStoreState>>;

const createMainStoreState: StateCreator<StoreState> = (set, get, api) => ({
	...createLocationSlice(set, get, api),
	...createTrailSlice(set, get, api),
});

/**
 * The server's stand-in for a store: the real initial state and actions over a
 * `set` that does nothing, so server-rendered defaults match the client's by
 * construction. Mirrors zustand's bound-store call signatures: bare calls
 * return the whole state (e.g. `const { units } = useMapStore()`), selector
 * calls project it.
 */
function createServerStore<S>(createState: StateCreator<S>): UseBoundStore<StoreApi<S>> {
	const api: StoreApi<S> = {
		setState: () => {},
		getState: () => state,
		getInitialState: () => state,
		subscribe: () => () => {},
	};
	const state = createState(api.setState, api.getState, api);
	const useBoundStore = (selector?: (state: S) => unknown): unknown => (selector ? selector(state) : state);
	return Object.assign(useBoundStore, api) as UseBoundStore<StoreApi<S>>;
}

function createStores(): { main: MainStore; map: MapStore } {
	if (typeof window === 'undefined') {
		const main = createServerStore(createMainStoreState);
		return { main, map: createServerStore(createMapStoreState(() => main.getState())) };
	}
	const main = create<StoreState>()(createMainStoreState);
	return { main, map: createMapStore(() => main.getState()) };
}

const stores = createStores();

export const useStore = stores.main;
export const useMapStore = stores.map;
