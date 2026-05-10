'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { useTranslations } from 'next-intl';

type SeverityLevel = 'yellow' | 'orange' | 'red';

const SEVERITY_STYLES: Record<SeverityLevel, L.PathOptions> = {
	yellow: { fillColor: '#FFEE58', color: '#F9A825', fillOpacity: 0.25, weight: 2 },
	orange: { fillColor: '#FFA726', color: '#E65100', fillOpacity: 0.3, weight: 2 },
	red: { fillColor: '#EF5350', color: '#B71C1C', fillOpacity: 0.35, weight: 3 },
};

const DEFAULT_STYLE: L.PathOptions = { fillColor: '#FFEE58', color: '#F9A825', fillOpacity: 0.25, weight: 2 };

function resolveSeverity(feature: GeoJSON.Feature): SeverityLevel {
	const raw = feature.properties?.severity as string | undefined;
	if (raw === 'Extreme' || raw === 'Severe') return 'red';
	if (raw === 'Moderate') return 'orange';
	return 'yellow';
}

function buildPopupContent(
	feature: GeoJSON.Feature,
	t: (key: string) => string,
): HTMLElement {
	const container = document.createElement('div');
	container.className = 'map-tooltip';

	const severity = feature.properties?.severity as string | undefined;
	const event = feature.properties?.event as string | undefined;
	const onset = feature.properties?.onset as string | undefined;
	const expires = feature.properties?.expires as string | undefined;
	const senderName = feature.properties?.senderName as string | undefined;

	const lines: Array<{ label: string; value: string | undefined }> = [
		{ label: t('severity'), value: severity },
		{ label: t('event'), value: event },
		{ label: t('validUntil'), value: expires ? new Date(expires).toLocaleString() : onset },
		{ label: t('source'), value: senderName },
	];

	for (const { label, value } of lines) {
		if (!value) continue;
		const row = document.createElement('div');
		const labelEl = document.createElement('strong');
		labelEl.textContent = `${label} `;
		row.appendChild(labelEl);
		row.appendChild(document.createTextNode(value));
		container.appendChild(row);
	}

	return container;
}

export function SevereWeatherLayer(): null {
	const map = useMap();
	const t = useTranslations('severeWeather');
	const layerEnabled = useMapStore((s: MapStoreState) => s.severeWeatherLayer);
	const data = useMapStore((s: MapStoreState) => s.severeWeatherData);
	const layerRef = useRef<L.GeoJSON | null>(null);

	useEffect(() => {
		if (!layerEnabled || !data) {
			if (layerRef.current) {
				map.removeLayer(layerRef.current);
				layerRef.current = null;
			}
			return;
		}

		const geoJsonLayer = L.geoJSON(data, {
			style: (feature) => {
				if (!feature) return DEFAULT_STYLE;
				const severity = resolveSeverity(feature);
				return SEVERITY_STYLES[severity] ?? DEFAULT_STYLE;
			},
			onEachFeature: (feature, layer) => {
				layer.on('click', (e: L.LeafletMouseEvent) => {
					const content = buildPopupContent(feature, t);
					L.popup({ className: 'map-tooltip', offset: [0, -5] })
						.setLatLng(e.latlng)
						.setContent(content)
						.openOn(map);
				});
			},
		});

		geoJsonLayer.addTo(map);
		layerRef.current = geoJsonLayer;

		return () => {
			if (layerRef.current) {
				map.removeLayer(layerRef.current);
				layerRef.current = null;
			}
		};
	}, [map, layerEnabled, data, t]);

	return null;
}
