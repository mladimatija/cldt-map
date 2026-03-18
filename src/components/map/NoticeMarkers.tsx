'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useStore, type StoreState } from '@/lib/store';
import { loadNotices } from '@/lib/notices';

export function NoticeMarkers(): null {
	const map = useMap();
	const gpxLoaded = useStore((state: StoreState) => state.gpxLoaded);
	const findTrailPointByDistance = useStore((state: StoreState) => state.findTrailPointByDistance);
	const markersRef = useRef<L.Marker[]>([]);

	useEffect(() => {
		if (!gpxLoaded) return;

		void loadNotices().then((notices) => {
			// Clear any previously placed markers first.
			for (const m of markersRef.current) m.removeFrom(map);
			markersRef.current = [];

			for (const notice of notices) {
				if (notice.distanceStartKm === undefined) continue;
				const point = findTrailPointByDistance(notice.distanceStartKm * 1000);
				if (!point) continue;

				const icon = L.divIcon({
					className: `notice-marker notice-marker--${notice.severity}`,
					html: '<div class="notice-marker-dot">!</div>',
					iconSize: [24, 24],
					iconAnchor: [12, 12],
				});

				const marker = L.marker([point.lat, point.lng], { icon, zIndexOffset: 200 });
				marker.bindPopup(`<strong>${notice.title}</strong><p class="mt-1">${notice.message}</p>`, {
					className: 'notice-marker-popup',
				});
				marker.addTo(map);
				markersRef.current.push(marker);
			}
		});

		return () => {
			for (const m of markersRef.current) m.removeFrom(map);
			markersRef.current = [];
		};
	}, [map, gpxLoaded, findTrailPointByDistance]);

	return null;
}
