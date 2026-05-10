'use client';

import React, { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { pointInPolygon } from '@/lib/point-in-polygon';
import type * as GeoJSON from 'geojson';

const DISMISSED_KEY = 'cldt-dismissed-weather-warnings';

type SeverityLevel = 'red' | 'orange' | 'yellow';

const SEVERITY_ORDER: Record<SeverityLevel, number> = { red: 3, orange: 2, yellow: 1 };

const SEVERITY_CLASSES: Record<SeverityLevel, string> = {
	red: 'bg-red-600 text-white',
	orange: 'bg-amber-400 text-amber-900',
	yellow: 'bg-yellow-300 text-yellow-900',
};

const SEVERITY_LABELS: Record<SeverityLevel, string> = {
	red: 'severityRed',
	orange: 'severityOrange',
	yellow: 'severityYellow',
};

function getDismissed(): Set<string> {
	try {
		const raw = sessionStorage.getItem(DISMISSED_KEY);
		return new Set(raw ? (JSON.parse(raw) as string[]) : []);
	} catch {
		return new Set();
	}
}

function persistDismissed(id: string): void {
	try {
		const set = getDismissed();
		set.add(id);
		sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
	} catch {
		// sessionStorage unavailable
	}
}

function resolveSeverity(feature: GeoJSON.Feature): SeverityLevel {
	const raw = feature.properties?.severity as string | undefined;
	if (raw === 'Extreme' || raw === 'Severe') return 'red';
	if (raw === 'Moderate') return 'orange';
	return 'yellow';
}

function getWarningId(feature: GeoJSON.Feature): string {
	const event = (feature.properties?.event as string) ?? 'unknown';
	const expires = (feature.properties?.expires as string) ?? '';
	return `${event}-${expires}`;
}

interface ActiveWarning {
	severity: SeverityLevel;
	event: string;
	id: string;
	feature: GeoJSON.Feature;
}

export function SevereWeatherBanner(): React.ReactElement | null {
	const t = useTranslations('severeWeather');
	const userLocation = useMapStore((s: MapStoreState) => s.userLocation);
	const severeWeatherData = useMapStore((s: MapStoreState) => s.severeWeatherData);
	const [dismissed, setDismissed] = useState<Set<string>>(() => getDismissed());

	const activeWarnings = useMemo((): ActiveWarning[] => {
		if (!userLocation || !severeWeatherData?.features) return [];

		const warnings: ActiveWarning[] = [];
		const point: [number, number] = [userLocation.lng, userLocation.lat];

		for (const feature of severeWeatherData.features) {
			const geom = feature.geometry;
			if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;
			if (!pointInPolygon(point, geom)) continue;

			const severity = resolveSeverity(feature);
			const event = (feature.properties?.event as string) ?? '';
			const id = getWarningId(feature);
			warnings.push({ severity, event, id, feature });
		}

		// Sort highest severity first
		warnings.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
		return warnings;
	}, [userLocation, severeWeatherData]);

	if (activeWarnings.length === 0) return null;

	// Filter out dismissed (non-red) warnings
	const visible = activeWarnings.filter((w) => {
		if (w.severity === 'red') return true;
		return !dismissed.has(w.id);
	});

	if (visible.length === 0) return null;

	const handleDismiss = (id: string): void => {
		persistDismissed(id);
		setDismissed((prev) => new Set([...prev, id]));
	};

	return (
		<div aria-label={t('bannerPrefix')} className="relative z-[var(--z-banner)]" role="region">
			{visible.map((w) => (
				<div
					className={`flex items-start gap-2 px-3 py-2 text-sm ${SEVERITY_CLASSES[w.severity]}`}
					key={w.id}
					role="alert"
				>
					<div className="min-w-0 flex-1">
						<span className="font-semibold">{t('bannerPrefix')}</span>
						<span className="ml-1">{t(SEVERITY_LABELS[w.severity])}</span>
						{w.event && <span className="ml-1">— {w.event}</span>}
					</div>
					{w.severity !== 'red' && (
						<button
							aria-label={t('dismiss')}
							className="shrink-0 leading-none font-bold opacity-80 hover:opacity-100"
							type="button"
							onClick={() => handleDismiss(w.id)}
						>
							×
						</button>
					)}
				</div>
			))}
		</div>
	);
}
