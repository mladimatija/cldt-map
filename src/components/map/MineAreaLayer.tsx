'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { useLocale, useTranslations } from 'next-intl';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { hasMineAreas, type MineAreasFile, type MineTrailRange } from '@/lib/mine-areas';
import { findNearestPointIndex } from '@/lib/distance-utils';
import { formatDistance } from '@/lib/utils';
import { formatIsoDate } from '@/lib/date-format';

const OFFICIAL_URL = 'https://misportal.hcr.hr/';

/** Solid red, dashed outline - unmistakably "do not enter", distinct from the
 *  severity-graded severe-weather fills. */
const AREA_STYLE: L.PathOptions = {
	color: '#dc2626',
	weight: 2,
	dashArray: '6 4',
	fillColor: '#dc2626',
	fillOpacity: 0.18,
};

interface PopupStrings {
	title: string;
	dataDate: string;
	officialSource: string;
	disclaimer: string;
	affectedRange?: string;
}

function buildPopupContent(strings: PopupStrings, name?: string): HTMLElement {
	const container = document.createElement('div');
	container.className = 'map-tooltip mine-area-popup';

	const title = document.createElement('strong');
	title.textContent = strings.title;
	container.appendChild(title);

	if (name) {
		const nameEl = document.createElement('div');
		nameEl.textContent = name;
		container.appendChild(nameEl);
	}
	if (strings.affectedRange) {
		const rangeEl = document.createElement('div');
		rangeEl.textContent = strings.affectedRange;
		container.appendChild(rangeEl);
	}

	const dateEl = document.createElement('div');
	dateEl.textContent = strings.dataDate;
	container.appendChild(dateEl);

	const disclaimerEl = document.createElement('p');
	disclaimerEl.className = 'mine-area-popup__disclaimer';
	disclaimerEl.textContent = strings.disclaimer;
	container.appendChild(disclaimerEl);

	const link = document.createElement('a');
	link.href = OFFICIAL_URL;
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.className = 'poi-popup__link';
	link.textContent = strings.officialSource;
	container.appendChild(link);

	return container;
}

/**
 * Mine-suspected area overlay: official MSP polygons near the trail plus a
 * warning chip on the polyline for every affected km range. Render-only;
 * the GPS warning lives in MineAreaBanner.
 */
export function MineAreaLayer(): null {
	const map = useMap();
	const t = useTranslations('mineAreas');
	const locale = useLocale();
	const tRef = useRef(t);
	useEffect(() => {
		tRef.current = t;
	}, [t]);

	const enabled = useMapStore((s: MapStoreState) => s.mineAreasEnabled);
	const file = useMapStore((s: MapStoreState) => s.mineAreasFile);
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);
	const direction = useStore((s: StoreState) => s.direction);
	const totalKm = useStore((s: StoreState) => s.trailMetadata.totalDistance);

	const groupRef = useRef<L.LayerGroup | null>(null);

	useEffect(() => {
		const removeGroup = (): void => {
			if (groupRef.current) {
				map.removeLayer(groupRef.current);
				groupRef.current = null;
			}
		};
		if (!enabled || !hasMineAreas(file)) {
			removeGroup();
			return;
		}

		const data: MineAreasFile = file;
		const group = L.layerGroup();

		const popupStrings = (range?: MineTrailRange): PopupStrings => {
			const toDisplayKm = (km: number): number => (direction === 'SOBO' ? km : Math.max(0, totalKm - km));
			let affectedRange: string | undefined;
			if (range) {
				const a = toDisplayKm(range.startKm);
				const b = toDisplayKm(range.endKm);
				affectedRange = tRef.current('affectedRange', {
					start: formatDistance(Math.min(a, b), units, distancePrecision),
					end: formatDistance(Math.max(a, b), units, distancePrecision),
				});
			}
			return {
				title: tRef.current('popoutTitle'),
				dataDate: `${tRef.current('dataDate')}: ${data.lastUpdated ? formatIsoDate(data.lastUpdated, locale) : '-'}`,
				officialSource: tRef.current('officialSource'),
				disclaimer: tRef.current('disclaimer'),
				affectedRange,
			};
		};

		for (const area of data.areas) {
			const polygon = L.geoJSON({ type: 'Feature', geometry: area.geometry, properties: {} } as GeoJSON.Feature, {
				style: AREA_STYLE,
			});
			polygon.on('click', (e: L.LeafletMouseEvent) => {
				L.popup({ className: 'mine-area-leaflet-popup', offset: [0, -5] })
					.setLatLng(e.latlng)
					.setContent(buildPopupContent(popupStrings(), area.name))
					.openOn(map);
			});
			group.addLayer(polygon);
		}

		// Warning chips on the polyline at the midpoint of each affected range.
		if (enhancedTrailPoints.length > 0) {
			for (const range of data.trailRanges) {
				const midKm = (range.startKm + range.endKm) / 2;
				const idx = findNearestPointIndex(enhancedTrailPoints, midKm * 1000);
				const pt = enhancedTrailPoints[idx];
				if (!pt) continue;
				const marker = L.marker([pt.lat, pt.lng], {
					icon: L.divIcon({
						className: 'mine-area-chip-wrapper',
						html: `<span class="mine-area-chip" aria-label="${tRef.current('popoutTitle')}">!</span>`,
						iconSize: [22, 22],
						iconAnchor: [11, 11],
					}),
					keyboard: false,
				});
				marker.on('click', () => {
					L.popup({ className: 'mine-area-leaflet-popup', offset: [0, -8] })
						.setLatLng([pt.lat, pt.lng])
						.setContent(buildPopupContent(popupStrings(range)))
						.openOn(map);
				});
				group.addLayer(marker);
			}
		}

		group.addTo(map);
		groupRef.current = group;
		return removeGroup;
	}, [map, enabled, file, enhancedTrailPoints, direction, totalKm, units, distancePrecision, locale]);

	return null;
}
