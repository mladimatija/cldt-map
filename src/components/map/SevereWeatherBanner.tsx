'use client';

import React, { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { pointInPolygon } from '@/lib/point-in-polygon';
import { resolveSeverity, type SeverityLevel } from '@/lib/severe-weather';
import type * as GeoJSON from 'geojson';

function quantize(n: number): number {
	return Math.round(n * 10000) / 10000;
}

const DISMISSED_KEY = 'cldt-dismissed-weather-warnings';

const SEVERITY_ORDER: Record<SeverityLevel, number> = { red: 3, orange: 2, yellow: 1 };

const SEVERITY_CLASSES: Record<SeverityLevel, string> = {
	red: 'bg-cldt-red text-white',
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

function getWarningId(feature: GeoJSON.Feature): string {
	const event = (feature.properties?.event as string) ?? 'unknown';
	const validUntil = (feature.properties?.validUntil as string) ?? '';
	return `${event}-${validUntil}`;
}

interface ActiveWarning {
	severity: SeverityLevel;
	event: string;
	id: string;
	feature: GeoJSON.Feature;
}

export function SevereWeatherBanner(): React.ReactElement | null {
	const t = useTranslations('severeWeather');
	const coarseLocationKey = useMapStore((s: MapStoreState) =>
		s.userLocation ? `${quantize(s.userLocation.lat)},${quantize(s.userLocation.lng)}` : null,
	);
	const severeWeatherData = useMapStore((s: MapStoreState) => s.severeWeatherData);
	const [dismissed, setDismissed] = useState<Set<string>>(() => getDismissed());

	const activeWarnings = useMemo((): ActiveWarning[] => {
		if (!coarseLocationKey || !severeWeatherData?.features) return [];

		const [lat, lng] = coarseLocationKey.split(',').map(Number);
		const warnings: ActiveWarning[] = [];
		const point: [number, number] = [lng, lat];

		for (const feature of severeWeatherData.features) {
			const geom = feature.geometry;
			if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;
			if (!pointInPolygon(point, geom)) continue;

			const severity = resolveSeverity(feature);
			const event = (feature.properties?.event as string) ?? '';
			const id = getWarningId(feature);
			warnings.push({ severity, event, id, feature });
		}

		warnings.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
		return warnings;
	}, [coarseLocationKey, severeWeatherData]);

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
						{w.event && <span className="ml-1">- {w.event}</span>}
					</div>
					{w.severity !== 'red' && (
						<button
							aria-label={t('dismiss')}
							className="focus-visible:ring-cldt-green flex min-h-[var(--min-touch-target)] min-w-[var(--min-touch-target)] shrink-0 items-center justify-center rounded p-1 leading-none font-bold opacity-80 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-1"
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
