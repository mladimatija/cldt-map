'use client';

import React from 'react';
import { BaseMapProvider } from '@/lib/services/map-service';
import { isBaseMapProviderAvailable } from '@/lib/services/map-service-config';
import {
	FaMap,
	FaMountain,
	FaSatellite,
	FaMapMarkedAlt,
	FaBiking,
	FaLocationArrow,
	FaMoon,
	FaHiking,
} from 'react-icons/fa';

/** Share URL key → provider (for applying a shared style). Its keys are the
 *  base-map values a share link can carry. */
export const KEY_TO_PROVIDER = {
	standard: BaseMapProvider.OPEN_STREET_MAP,
	topo: BaseMapProvider.OPEN_TOPO_MAP,
	satellite: BaseMapProvider.SATELLITE,
	terrain: BaseMapProvider.TERRAIN,
	cycling: BaseMapProvider.CYCL_OSM,
	openHikingMap: BaseMapProvider.OPEN_HIKING_MAP,
	croatiaTopo: BaseMapProvider.CROATIA_TOPO,
	darkMap: BaseMapProvider.DARK,
} as const satisfies Record<string, BaseMapProvider>;

/** Short base-map keys used in share URLs (e.g. standard, topo, croatiaTopo, darkMap). */
export type ShareBaseMapKey = keyof typeof KEY_TO_PROVIDER;

export function isShareBaseMapKey(value: string): value is ShareBaseMapKey {
	return Object.hasOwn(KEY_TO_PROVIDER, value);
}

export const PROVIDER_TO_KEY: Record<BaseMapProvider, ShareBaseMapKey> = {
	[BaseMapProvider.OPEN_STREET_MAP]: 'standard',
	[BaseMapProvider.OPEN_TOPO_MAP]: 'topo',
	[BaseMapProvider.SATELLITE]: 'satellite',
	[BaseMapProvider.TERRAIN]: 'terrain',
	[BaseMapProvider.CYCL_OSM]: 'cycling',
	[BaseMapProvider.OPEN_HIKING_MAP]: 'openHikingMap',
	[BaseMapProvider.CROATIA_TOPO]: 'croatiaTopo',
	[BaseMapProvider.DARK]: 'darkMap',
};

export interface MapOption {
	id: BaseMapProvider;
	name: string;
	description: string;
	icon: React.ReactNode;
}

const iconClass = 'h-4 w-4 dark:text-white';

const allMapOptions: MapOption[] = [
	{
		id: BaseMapProvider.OPEN_STREET_MAP,
		name: 'Standard',
		description: 'OpenStreetMap standard view',
		icon: <FaMap className={iconClass} />,
	},
	{
		id: BaseMapProvider.OPEN_TOPO_MAP,
		name: 'Topo',
		description: 'Topographic map with contour lines',
		icon: <FaMountain className={`${iconClass} text-cldt-green`} />,
	},
	{
		id: BaseMapProvider.OPEN_HIKING_MAP,
		name: 'Hiking',
		description: 'OpenHikingMap: topo style with hiking-specific details',
		icon: <FaHiking className={`${iconClass} text-cldt-blue`} />,
	},
	{
		id: BaseMapProvider.SATELLITE,
		name: 'Satellite',
		description: 'Satellite imagery',
		icon: <FaSatellite className={`${iconClass} text-gray-800`} />,
	},
	{
		id: BaseMapProvider.TERRAIN,
		name: 'Terrain',
		description: 'Terrain view with shaded relief',
		icon: <FaMapMarkedAlt className={`${iconClass} text-amber-700`} />,
	},
	{
		id: BaseMapProvider.CYCL_OSM,
		name: 'Cycling',
		description: 'OpenCycleMap for cyclists and hiking',
		icon: <FaBiking className={`${iconClass} text-cldt-blue`} />,
	},
	{
		id: BaseMapProvider.CROATIA_TOPO,
		name: 'Croatia Topo',
		description: 'Official Croatian topographic maps',
		icon: <FaLocationArrow className={`${iconClass} text-cldt-red`} />,
	},
	{
		id: BaseMapProvider.DARK,
		name: 'Dark',
		description: 'Dark base layer for night or low-light use',
		icon: <FaMoon className={iconClass} />,
	},
];

/** Styles offered in the selector: Dark is left out when the CARTO key is missing. */
export const mapOptions: MapOption[] = allMapOptions.filter((option) => isBaseMapProviderAvailable(option.id));

export const VALID_PROVIDERS = new Set<BaseMapProvider>(
	Object.values(BaseMapProvider).filter((provider) => isBaseMapProviderAvailable(provider)),
);

export function resolveProvider(storeValue: string | undefined, fallback: BaseMapProvider): BaseMapProvider {
	if (storeValue && VALID_PROVIDERS.has(storeValue as BaseMapProvider)) {
		return storeValue as BaseMapProvider;
	}
	return fallback;
}
