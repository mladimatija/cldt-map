'use client';

import React from 'react';
import { BaseMapProvider } from '@/lib/services/map-service';
import { FaMap, FaMountain, FaSatellite, FaMapMarkedAlt, FaBiking, FaLocationArrow } from 'react-icons/fa';

export const PROVIDER_TO_KEY: Record<BaseMapProvider, string> = {
	[BaseMapProvider.OPEN_STREET_MAP]: 'standard',
	[BaseMapProvider.OPEN_TOPO_MAP]: 'topo',
	[BaseMapProvider.SATELLITE]: 'satellite',
	[BaseMapProvider.TERRAIN]: 'terrain',
	[BaseMapProvider.CYCL_OSM]: 'cycling',
	[BaseMapProvider.CROATIA_TOPO]: 'croatiaTopo',
};

export interface MapOption {
	id: BaseMapProvider;
	name: string;
	description: string;
	icon: React.ReactNode;
}

const iconClass = 'h-4 w-4 text-gray-700 dark:text-white';

export const mapOptions: MapOption[] = [
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
		icon: <FaMountain className={`${iconClass} text-green-700`} />,
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
		icon: <FaBiking className={`${iconClass} text-blue-600`} />,
	},
	{
		id: BaseMapProvider.CROATIA_TOPO,
		name: 'Croatia Topo',
		description: 'Official Croatian topographic maps',
		icon: <FaLocationArrow className={`${iconClass} text-red-600`} />,
	},
];

export const VALID_PROVIDERS = new Set<BaseMapProvider>(Object.values(BaseMapProvider));

export function resolveProvider(storeValue: string | undefined, fallback: BaseMapProvider): BaseMapProvider {
	if (storeValue && VALID_PROVIDERS.has(storeValue as BaseMapProvider)) {
		return storeValue as BaseMapProvider;
	}
	return fallback;
}
