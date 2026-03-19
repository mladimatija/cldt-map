'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { useLocale } from 'next-intl';
import L from 'leaflet';
import { useStore, type StoreState } from '@/lib/store';
import { loadNotices, resolveLocalized } from '@/lib/notices';

export function NoticeMarkers(): null {
	const map = useMap();
	const locale = useLocale();
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

				// Build popup using DOM nodes so notice content is never treated as HTML.
				const popupEl = document.createElement('div');
				const titleEl = document.createElement('strong');
				titleEl.textContent = resolveLocalized(notice.title, locale);
				popupEl.appendChild(titleEl);
				const msgEl = document.createElement('p');
				msgEl.className = 'mt-1';
				msgEl.textContent = resolveLocalized(notice.message, locale);
				popupEl.appendChild(msgEl);

				marker.bindPopup(popupEl, { className: 'notice-marker-popup' });
				marker.addTo(map);
				markersRef.current.push(marker);
			}
		});

		return () => {
			for (const m of markersRef.current) m.removeFrom(map);
			markersRef.current = [];
		};
	}, [map, gpxLoaded, findTrailPointByDistance, locale]);

	return null;
}
