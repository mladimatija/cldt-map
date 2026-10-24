'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { useLocale, useTranslations } from 'next-intl';

import {
	highestSeverity,
	regionWarnings,
	SEVERE_WEATHER_ATTRIBUTION,
	warningIsCurrent,
	warningIsExpired,
	type SeverityLevel,
} from '@/lib/severe-weather';

const SEVERITY_STYLES: Record<SeverityLevel, L.PathOptions> = {
	yellow: { fillColor: '#f59e0b', color: '#f59e0b', fillOpacity: 0.15, weight: 1 },
	orange: { fillColor: '#f97316', color: '#f97316', fillOpacity: 0.2, weight: 1.5 },
	red: { fillColor: '#e1584d', color: '#e1584d', fillOpacity: 0.25, weight: 2 },
};

/** A county whose warnings have not started yet: same colour, dashed and faint. */
function upcomingStyle(severity: SeverityLevel): L.PathOptions {
	const base = SEVERITY_STYLES[severity];
	return { ...base, fillOpacity: (base.fillOpacity ?? 0.15) / 2, dashArray: '4 4' };
}

/** Style by the strongest warning in force now, else by the strongest upcoming one. */
function regionStyle(feature: GeoJSON.Feature | undefined, now: number): L.PathOptions {
	const warnings = feature ? regionWarnings(feature).filter((w) => !warningIsExpired(w, now)) : [];
	const current = highestSeverity(warnings.filter((w) => warningIsCurrent(w, now)));
	if (current) return SEVERITY_STYLES[current];
	return upcomingStyle(highestSeverity(warnings) ?? 'yellow');
}

const SEVERITY_LABEL_KEYS: Record<SeverityLevel, string> = {
	red: 'severityRed',
	orange: 'severityOrange',
	yellow: 'severityYellow',
};

/** One block per warning in the county: level and type, event, validity, source. */
function buildPopupContent(feature: GeoJSON.Feature, t: (key: string) => string, locale: string): HTMLElement {
	const container = document.createElement('div');
	container.className = 'map-tooltip';

	const regionName = feature.properties?.regionName as string | undefined;
	if (regionName) {
		const heading = document.createElement('div');
		const label = document.createElement('strong');
		label.textContent = `${t('region')} `;
		heading.append(label, document.createTextNode(regionName));
		container.appendChild(heading);
	}

	const formatTime = (iso: string): string => {
		const date = new Date(iso);
		return Number.isFinite(date.getTime())
			? date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
			: '';
	};

	const now = Date.now();
	for (const warning of regionWarnings(feature)) {
		if (warningIsExpired(warning, now)) continue;
		const block = document.createElement('div');
		block.className = 'mt-1';
		const from = warning.validFrom ? formatTime(warning.validFrom) : '';
		const until = warning.validUntil ? formatTime(warning.validUntil) : '';
		const lines: Array<{ label: string; value: string }> = [
			{
				label: t('severity'),
				value: [t(SEVERITY_LABEL_KEYS[warning.severity]), warning.awarenessType && t(`type.${warning.awarenessType}`)]
					.filter(Boolean)
					.join(', '),
			},
			{ label: t('event'), value: warning.event },
			from && until ? { label: t('valid'), value: `${from} - ${until}` } : { label: t('validUntil'), value: until },
			{ label: t('source'), value: warning.source },
		];
		for (const { label, value } of lines) {
			if (!value) continue;
			const row = document.createElement('div');
			const labelEl = document.createElement('strong');
			labelEl.textContent = `${label} `;
			row.appendChild(labelEl);
			row.appendChild(document.createTextNode(value));
			block.appendChild(row);
		}
		container.appendChild(block);
	}

	return container;
}

export function SevereWeatherLayer(): null {
	const map = useMap();
	const t = useTranslations('severeWeather');
	const locale = useLocale();
	const tRef = useRef(t);
	const localeRef = useRef(locale);
	useEffect(() => {
		tRef.current = t;
		localeRef.current = locale;
	}, [t, locale]);
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
				attribution: SEVERE_WEATHER_ATTRIBUTION,
				style: (feature) => regionStyle(feature, Date.now()),
				onEachFeature: (feature, layer) => {
					layer.on('click', (e: L.LeafletMouseEvent) => {
						const content = buildPopupContent(feature, tRef.current, localeRef.current);
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
			// Counties whose warnings are all over drop out until the next poll.
			const now = Date.now();
			const visible: GeoJSON.FeatureCollection = {
				...data,
				features: data.features.filter((f) => regionWarnings(f).some((w) => !warningIsExpired(w, now))),
			};
			layerRef.current.addData(visible);
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
