'use client';

/**
 * Dev-only driver for the off-route alert, rendered on the /test page.
 *
 * Injects synthetic GPS fixes (map-store user location + trail-store closest
 * point) so the REAL OffRouteAlertBanner mounted below steps its machine
 * exactly as it would from live GPS on the map page. The machine state shown
 * here is published by the banner itself via the dev-only
 * `offRouteMachineUpdate` event, so the readout is the truth rather than a
 * parallel simulation that could drift.
 *
 * Walkthrough: enable the feature, send ARM_FIXES on-trail fixes to arm,
 * then ALERT_FIXES off-trail fixes to raise the banner. A far fix exercises
 * the auto-disarm path; an inaccurate fix should change nothing.
 */
import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { L } from '@/lib/store/leaflet';
import { OFF_ROUTE, OFF_ROUTE_INITIAL, type OffRouteMachineState } from '@/lib/off-route-alert';
import { OffRouteAlertBanner } from '@/components/map/OffRouteAlertBanner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/** A plausible point on the trail (Velebit area); only the geometry matters. */
const TRAIL_POINT = { lat: 44.8137, lng: 15.2317 };
const METERS_PER_DEG_LAT = 111320;

export function OffRouteAlertSimulator(): React.ReactElement {
	const t = useTranslations('storeTest');
	const enabled = useMapStore((s: MapStoreState) => s.offRouteAlertEnabled);
	const setOffRouteAlertEnabled = useMapStore((s: MapStoreState) => s.setOffRouteAlertEnabled);
	const setUserLocation = useMapStore((s: MapStoreState) => s.setUserLocation);
	const setClosestPoint = useStore((s: StoreState) => s.setClosestPoint);

	const [machine, setMachine] = useState<OffRouteMachineState>(OFF_ROUTE_INITIAL);
	const [fixesSent, setFixesSent] = useState(0);

	useEffect(() => {
		const onMachine = (event: Event): void => {
			setMachine((event as CustomEvent<OffRouteMachineState>).detail);
		};
		window.addEventListener('offRouteMachineUpdate', onMachine);
		return () => window.removeEventListener('offRouteMachineUpdate', onMachine);
	}, []);

	const sendFix = (distanceM: number, accuracyM: number): void => {
		// Place the user due north of the trail point so the banner's bearing
		// back to the trail reads S (180 deg). Both store writes batch into a
		// single render, so the banner steps its machine exactly once per fix.
		setUserLocation({
			lat: TRAIL_POINT.lat + distanceM / METERS_PER_DEG_LAT,
			lng: TRAIL_POINT.lng,
			accuracy: accuracyM,
		});
		setClosestPoint({
			// Leaflet LatLng instance to match the ClosestPoint type; only the
			// click handler runs this, so the SSR-guarded L is always loaded.
			point: L.latLng(TRAIL_POINT.lat, TRAIL_POINT.lng),
			distance: distanceM,
			distanceFromStart: 612_000,
			distanceToEnd: 1_588_000,
		});
		setFixesSent((n) => n + 1);
	};

	// Disabling doubles as reset: the banner resets its machine when the
	// feature toggles off, and the synthetic fixes are cleared so a re-enable
	// starts from a blank slate.
	const disableAndReset = (): void => {
		setOffRouteAlertEnabled(false);
		setUserLocation(null);
		setClosestPoint(null);
		setFixesSent(0);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('offRouteTitle')}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-sm text-gray-600">{t('offRouteDescription')}</p>

				<div>
					<Button
						size="default"
						variant={enabled ? 'selected' : 'primary'}
						onClick={() => (enabled ? disableAndReset() : setOffRouteAlertEnabled(true))}
					>
						{enabled ? t('disable') : t('enable')}
					</Button>
				</div>

				<div className="space-y-1 text-sm">
					<p>
						{t('offRoutePhase')}: <span className="text-cldt-blue font-mono font-semibold">{machine.phase}</span>
					</p>
					<p>
						{t('offRouteCounters')}:{' '}
						<span className="font-mono">
							on {machine.onCount}/{OFF_ROUTE.ARM_FIXES} &middot; off {machine.offCount}/{OFF_ROUTE.ALERT_FIXES}{' '}
							&middot; away {machine.awayCount}/{OFF_ROUTE.DISARM_FIXES}
						</span>
					</p>
					<p>
						{t('offRouteFixesSent')}: <span className="font-mono">{fixesSent}</span>
					</p>
				</div>

				<div className="flex flex-wrap gap-2">
					<Button disabled={!enabled} size="default" variant="base" onClick={() => sendFix(40, 10)}>
						{t('offRouteFixOn')}
					</Button>
					<Button disabled={!enabled} size="default" variant="base" onClick={() => sendFix(350, 10)}>
						{t('offRouteFixOff')}
					</Button>
					<Button disabled={!enabled} size="default" variant="base" onClick={() => sendFix(2500, 10)}>
						{t('offRouteFixFar')}
					</Button>
					<Button disabled={!enabled} size="default" variant="base" onClick={() => sendFix(350, 120)}>
						{t('offRouteFixInaccurate')}
					</Button>
				</div>
				{!enabled && <p className="text-sm text-gray-600">{t('offRouteEnableFirst')}</p>}

				<div className="overflow-hidden rounded border border-dashed border-gray-300">
					<OffRouteAlertBanner />
					{machine.phase !== 'alerting' && (
						<p className="px-3 py-2 text-sm text-gray-500">{t('offRouteBannerEmpty')}</p>
					)}
				</div>
				<p className="text-xs text-gray-600">{t('offRouteSnoozedHint')}</p>
			</CardContent>
		</Card>
	);
}
