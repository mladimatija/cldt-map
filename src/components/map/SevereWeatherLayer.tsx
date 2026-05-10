'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { useTranslations } from 'next-intl';

import { resolveSeverity, type SeverityLevel } from '@/lib/severe-weather';

const SEVERITY_STYLES: Record<SeverityLevel, L.PathOptions> = {
	yellow: { fillColor: '#f59e0b', color: '#f59e0b', fillOpacity: 0.15, weight: 1 },
	orange: { fillColor: '#f97316', color: '#f97316', fillOpacity: 0.2, weight: 1.5 },
	red: { fillColor: '#e1584d', color: '#e1584d', fillOpacity: 0.25, weight: 2 },
};

function buildPopupContent(feature: GeoJSON.Feature, t: (key: string) => string): HTMLElement {
	const container = document.createElement('div');
	container.className = 'map-tooltip';

	const severity = feature.properties?.severity as string | undefined;
	const event = feature.properties?.event as string | undefined;
	const validFrom = feature.properties?.validFrom as string | undefined;
	const validUntil = feature.properties?.validUntil as string | undefined;
	const source = feature.properties?.source as string | undefined;

	const validWindow =
		validFrom && validUntil
			? `${new Date(validFrom).toLocaleString()} – ${new Date(validUntil).toLocaleString()}`
			: validUntil
				? new Date(validUntil).toLocaleString()
				: undefined;

	const lines: Array<{ label: string; value: string | undefined }> = [
		{ label: t('severity'), value: severity },
		{ label: t('event'), value: event },
		{ label: t('validUntil'), value: validWindow },
		{ label: t('source'), value: source },
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
	const tRef = useRef(t);
	useEffect(() => {
		tRef.current = t;
	}, [t]);
	const layerEnabled = useMapStore((s: MapStoreState) => s.severeWeatherLayer);
	const data = useMapStore((s: MapStoreState) => s.severeWeatherData);
	const layerRef = useRef<L.GeoJSON | null>(null);

	useEffect(() => {
		if (!layerEnabled) {
			if (layerRef.current) {
				map.removeLayer(layerRef.current);
				layerRef.current = null;
			}
			return;
		}

		if (!layerRef.current) {
			const geoJsonLayer = L.geoJSON(undefined, {
				style: (feature) => {
					if (!feature) return SEVERITY_STYLES['yellow'];
					return SEVERITY_STYLES[resolveSeverity(feature)] ?? SEVERITY_STYLES['yellow'];
				},
				onEachFeature: (feature, layer) => {
					layer.on('click', (e: L.LeafletMouseEvent) => {
						const content = buildPopupContent(feature, tRef.current);
						L.popup({ className: 'severe-weather-popup', offset: [0, -5] })
							.setLatLng(e.latlng)
							.setContent(content)
							.openOn(map);
					});
				},
			});
			geoJsonLayer.addTo(map);
			layerRef.current = geoJsonLayer;
		}

		layerRef.current.clearLayers();
		if (data) {
			layerRef.current.addData(data);
		}

		return () => {
			if (layerRef.current) {
				map.removeLayer(layerRef.current);
				layerRef.current = null;
			}
		};
	}, [map, layerEnabled, data]);

	return null;
}
