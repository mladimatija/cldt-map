'use client';

import React, { useRef } from 'react';
import { useBlockMapPropagation } from '@/hooks';
import { useMapStore, type MapStoreState } from '@/lib/store';
import MapControlsLocationButton from './MapControlsLocationButton';
import MapControlsUserLocationToggleButton from './MapControlsUserLocationToggleButton';

interface LocationControlsProps {
	checkPermission?: (prompt: boolean) => Promise<void>;
}

export default function MapControlsLocationControls({ checkPermission }: LocationControlsProps): React.ReactElement {
	const containerRef = useRef<HTMLDivElement>(null);
	useBlockMapPropagation(containerRef);
	const gpxLoadFailed = useMapStore((state: MapStoreState) => state.gpxLoadFailed);

	return (
		<div
			className={`z-controls absolute right-2 bottom-2 flex flex-col gap-2 ${gpxLoadFailed ? 'pointer-events-none opacity-60' : ''}`}
			ref={containerRef}
		>
			<MapControlsUserLocationToggleButton />
			<MapControlsLocationButton checkPermission={checkPermission} />
		</div>
	);
}
