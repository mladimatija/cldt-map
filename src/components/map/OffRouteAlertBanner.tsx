'use client';

/**
 * Off-route alert: a red banner plus a vibration burst when the hiker has
 * drifted off the trail. The settings toggle enables the capability; the
 * state machine in lib/off-route-alert decides when an alarm is warranted -
 * dormant until several consecutive fixes land ON the trail, so users who
 * are in Croatia but nowhere near the route (or just driving past a
 * crossing) are never bothered. Leaving the trail area entirely (taxi,
 * end of day) self-silences back to dormant.
 *
 * Dismissing snoozes the banner until the alert resolves (back on trail)
 * and a new drift occurs.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { OFF_ROUTE_INITIAL, offRouteStep, type OffRouteMachineState, type OffRoutePhase } from '@/lib/off-route-alert';
import { computeBearing } from '@/lib/distance-utils';
import { bearingToCompass } from '@/lib/emergency-data';
import { formatDistance } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { BANNER_REGION_CLASSES, BANNER_ROW_CLASSES, BANNER_RED_CLASSES } from './banner-styles';

/** Dev-only: publishes each machine step so the test page simulator can show
 *  the real machine state. The branch is compiled out of production builds. */
function emitMachineDev(state: OffRouteMachineState): void {
	if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent('offRouteMachineUpdate', { detail: state }));
	}
}

export function OffRouteAlertBanner(): React.ReactElement | null {
	const t = useTranslations('offRoute');
	const tEmergency = useTranslations('emergency');
	const enabled = useMapStore((s: MapStoreState) => s.offRouteAlertEnabled);
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);
	const userLocation = useMapStore((s: MapStoreState) => s.userLocation);
	const closestPoint = useStore((s: StoreState) => s.closestPoint);

	const machineRef = useRef(OFF_ROUTE_INITIAL);
	const wasEnabledRef = useRef(false);
	const [view, setView] = useState<{ phase: OffRoutePhase; snoozed: boolean }>({
		phase: 'dormant',
		snoozed: false,
	});

	// Step the machine on every fix (closestPoint recomputes per location
	// update). Toggling the feature off resets the machine (refs only, no
	// render); on re-enable the rendered phase reconciles through the
	// functional update below, which bails out when nothing changed.
	useEffect(() => {
		if (!enabled) {
			wasEnabledRef.current = false;
			machineRef.current = OFF_ROUTE_INITIAL;
			emitMachineDev(OFF_ROUTE_INITIAL);
			return;
		}
		if (!wasEnabledRef.current) {
			wasEnabledRef.current = true;
			machineRef.current = OFF_ROUTE_INITIAL;
		}
		const next = offRouteStep(machineRef.current, closestPoint?.distance ?? null, userLocation?.accuracy);
		machineRef.current = next;
		emitMachineDev(next);
		setView((prev) => {
			if (prev.phase === next.phase) return prev;
			// Snooze only outlives the alert it silenced: any phase change
			// clears it so the next drift alerts again.
			return { phase: next.phase, snoozed: false };
		});
	}, [enabled, closestPoint, userLocation]);

	// One vibration burst per alert onset (Android; iOS Safari has no
	// vibration API - the banner carries the alert there).
	useEffect(() => {
		if (view.phase === 'alerting' && !view.snoozed && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
			navigator.vibrate([300, 150, 300, 150, 500]);
		}
	}, [view]);

	if (!enabled || view.phase !== 'alerting' || view.snoozed) return null;
	if (!closestPoint || !userLocation) return null;

	const bearing = computeBearing(userLocation.lat, userLocation.lng, closestPoint.point.lat, closestPoint.point.lng);
	const compass = bearingToCompass(bearing);
	const distanceLabel = formatDistance(closestPoint.distance, units, distancePrecision, true);

	return (
		<div className={BANNER_REGION_CLASSES} role="region">
			<div className={`${BANNER_ROW_CLASSES} ${BANNER_RED_CLASSES}`} role="alert">
				<div className="min-w-0 flex-1">
					<span className="font-semibold">{t('title')}</span>
					<span className="ml-1">{t('body', { distance: distanceLabel })}</span>
					<span className="ml-1">
						{t('backToTrail', { compass: tEmergency(`compass.${compass}`), bearing: Math.round(bearing) })}
					</span>
				</div>
				<Button
					aria-label={t('dismiss')}
					variant="bannerClose"
					onClick={() => setView((prev) => ({ ...prev, snoozed: true }))}
				>
					×
				</Button>
			</div>
		</div>
	);
}
