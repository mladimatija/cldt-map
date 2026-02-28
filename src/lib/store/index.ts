import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { StoreState, MapStoreState } from './types';
import { createLocationSlice } from './location-slice';
import { createTrailSlice } from './trail-slice';
import { createUISlice } from './ui-slice';
import { createMapStore } from './map-store';
import { createStoreStub, createMapStoreStub } from './stub';

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
	UIState,
	UIActions,
	UISlice,
} from './types';

type MainStore = UseBoundStore<StoreApi<StoreState>>;
type MapStore = UseBoundStore<StoreApi<MapStoreState>>;

let mainStore: MainStore | null = null;
let mapStore: MapStore | null = null;

function createMainStore(): MainStore {
	return create<StoreState>()((set, get, api) => ({
		...createLocationSlice(set, get, api),
		...createTrailSlice(set, get, api),
		...createUISlice(set, get, api),
	}));
}

function createStoredStores(): { main: MainStore; map: MapStore } {
	const main = createMainStore();
	const map = createMapStore(() => main.getState());
	return { main, map };
}

function createStoreStubApi<S>(getStub: () => S): UseBoundStore<StoreApi<S>> {
	const stub = getStub();
	const api = ((selector: (state: S) => unknown) => selector(stub)) as unknown as UseBoundStore<StoreApi<S>>;
	(api as unknown as { getState: () => S }).getState = getStub;
	(api as unknown as { subscribe: () => () => void }).subscribe = () => () => {};
	return api;
}

const mainStub = createStoreStubApi(createStoreStub) as unknown as MainStore;
const mapStub = createStoreStubApi(createMapStoreStub) as unknown as MapStore;

if (typeof window !== 'undefined') {
	const { main, map } = createStoredStores();
	mainStore = main;
	mapStore = map;
}

export const useStore = mainStore ?? mainStub;
export const useMapStore = mapStore ?? mapStub;
