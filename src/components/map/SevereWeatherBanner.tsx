'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { pointInPolygon } from '@/lib/point-in-polygon';
import { regionWarnings, SEVERITY_ORDER, warningIsCurrent, type SeverityLevel } from '@/lib/severe-weather';
import { Button } from '@/components/ui/Button';
import { BANNER_REGION_CLASSES, BANNER_ROW_CLASSES, BANNER_RED_CLASSES } from './banner-styles';

function quantize(n: number): number {
	return Math.round(n * 10000) / 10000;
}

const DISMISSED_KEY = 'cldt-dismissed-weather-warnings';

/** Warnings start and end between polls; the banner re-checks this often. */
const CLOCK_TICK_MS = 60_000;

const SEVERITY_CLASSES: Record<SeverityLevel, string> = {
	red: BANNER_RED_CLASSES,
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

interface ActiveWarning {
	/** The alert id: dismissing it hides it in every county the alert covers. */
	id: string;
	severity: SeverityLevel;
	event: string;
	regionName: string;
}

export function SevereWeatherBanner(): React.ReactElement | null {
	const t = useTranslations('severeWeather');
	const coarseLocationKey = useMapStore((s: MapStoreState) =>
		s.userLocation ? `${quantize(s.userLocation.lat)},${quantize(s.userLocation.lng)}` : null,
	);
	const severeWeatherData = useMapStore((s: MapStoreState) => s.severeWeatherData);
	const [dismissed, setDismissed] = useState<Set<string>>(() => getDismissed());

	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
		return () => window.clearInterval(id);
	}, []);

	const activeWarnings = useMemo((): ActiveWarning[] => {
		if (!coarseLocationKey || !severeWeatherData?.features) return [];

		const [lat, lng] = coarseLocationKey.split(',').map(Number);
		const byId = new Map<string, ActiveWarning>();
		const point: [number, number] = [lng, lat];

		for (const feature of severeWeatherData.features) {
			const geom = feature.geometry;
			if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;
			if (!pointInPolygon(point, geom)) continue;

			const regionName = (feature.properties?.regionName as string | undefined) ?? '';
			// Only warnings in force now: upcoming ones are on the map, expired ones gone.
			for (const warning of regionWarnings(feature)) {
				if (!warningIsCurrent(warning, now) || byId.has(warning.id)) continue;
				byId.set(warning.id, { id: warning.id, severity: warning.severity, event: warning.event, regionName });
			}
		}

		return [...byId.values()].sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
	}, [coarseLocationKey, severeWeatherData, now]);

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
		<div aria-label={t('bannerPrefix')} className={BANNER_REGION_CLASSES} role="region">
			{visible.map((w) => (
				<div className={`${BANNER_ROW_CLASSES} ${SEVERITY_CLASSES[w.severity]}`} key={w.id} role="alert">
					<div className="min-w-0 flex-1">
						<span className="font-semibold">{t('bannerPrefix')}</span>
						<span className="ml-1">{t(SEVERITY_LABELS[w.severity])}</span>
						{w.event && <span className="ml-1">- {w.event}</span>}
						{w.regionName && <span className="ml-1">({w.regionName})</span>}
					</div>
					{w.severity !== 'red' && (
						<Button aria-label={t('dismiss')} variant="bannerClose" onClick={() => handleDismiss(w.id)}>
							×
						</Button>
					)}
				</div>
			))}
		</div>
	);
}
