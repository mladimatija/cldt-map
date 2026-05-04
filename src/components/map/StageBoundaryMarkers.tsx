'use client';

import React, { useMemo } from 'react';
import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { findNearestPointIndex } from '@/lib/distance-utils';

const BOUNDARY_ICON = L.divIcon({
	className: '',
	html: '<div style="width:2px;height:12px;background:var(--cldt-blue);border-radius:1px;"></div>',
	iconSize: [2, 12],
	iconAnchor: [1, 6],
});

export default function StageBoundaryMarkers(): React.ReactElement | null {
	const stagePlan = useMapStore((state: MapStoreState) => state.stagePlan);
	const enhancedTrailPoints = useStore((state: StoreState) => state.enhancedTrailPoints);

	const boundaries = useMemo(() => {
		if (!stagePlan || enhancedTrailPoints.length === 0) return [];
		return stagePlan.stages
			.slice(0, -1)
			.map((stage) => {
				const idx = findNearestPointIndex(enhancedTrailPoints, stage.endKm * 1000);
				return enhancedTrailPoints[idx];
			})
			.filter((p): p is (typeof enhancedTrailPoints)[number] => p !== undefined);
	}, [stagePlan, enhancedTrailPoints]);

	if (boundaries.length === 0) return null;

	return (
		<>
			{boundaries.map((point) => (
				<Marker
					icon={BOUNDARY_ICON}
					key={`${point.lat.toFixed(6)},${point.lng.toFixed(6)}`}
					position={[point.lat, point.lng]}
					zIndexOffset={-50}
				/>
			))}
		</>
	);
}
