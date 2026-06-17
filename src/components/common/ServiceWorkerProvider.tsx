'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { IoRefresh } from 'react-icons/io5';
import { Button } from '@/components/ui/Button';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { type BatteryManager, type NavigatorWithBattery, type NavigatorWithConnection } from '@/lib/tile-cache';
import { isAppUpdateWaiting } from '@/lib/sw-update';

interface ServiceWorkerProviderProps {
	children: React.ReactNode;
}

/** Auto-enable battery saver at or below this charge level while discharging.
 *  Applied at most once per low-battery episode so it never fights a user who
 *  turns it back off, and it never auto-disables. Feature-detected (no-op where
 *  the Battery Status API is unavailable, e.g. Safari/Firefox). */
const AUTO_BATTERY_SAVER_LEVEL = 0.2;

/**
 * Provider that manages service worker registration and updates
 */
export function ServiceWorkerProvider({ children }: ServiceWorkerProviderProps): React.ReactElement {
	const t = useTranslations('serviceWorker');
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
	const refreshingRef = useRef(false);
	const autoBatterySaverAppliedRef = useRef(false);

	const initOfflineDetection = useMapStore((state: MapStoreState) => state.initOfflineDetection);
	const initStaleCacheCheck = useMapStore((state: MapStoreState) => state.initStaleCacheCheck);
	const loadImportedTracksFromStorage = useMapStore((state: MapStoreState) => state.loadImportedTracksFromStorage);
	const selfHealStaleTiles = useMapStore((state: MapStoreState) => state.selfHealStaleTiles);
	const maybeRunPredictivePrecache = useMapStore((state: MapStoreState) => state.maybeRunPredictivePrecache);
	const handleQuotaExceeded = useMapStore((state: MapStoreState) => state.handleQuotaExceeded);
	// Lightweight boolean (not the array) so self-heal can wait for the async GPX
	// load without re-rendering on every trail-point change.
	const trailReady = useStore((state: StoreState) => state.enhancedTrailPoints.length > 1);

	// Only run service worker logic on the client side
	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}

		if (!('serviceWorker' in navigator)) return;
		if (process.env.NODE_ENV === 'development') return;

		const handleUpdateReady = (reg: ServiceWorkerRegistration): void => {
			registrationRef.current = reg;
			// `isAppUpdateWaiting` carries the controller gate: on a first install the
			// SW (which calls skipWaiting()) flickers through `waiting` with no
			// controller, which must not show a bogus "new version available" prompt
			// to first-time visitors. Shared with the offline-readiness readout.
			if (isAppUpdateWaiting(reg)) setUpdateAvailable(true);
		};

		const listenForInstall = (reg: ServiceWorkerRegistration): void => {
			const installing = reg.installing;
			if (!installing) return;
			installing.addEventListener('statechange', () => {
				// "installed" with an existing controller means a new version is now
				// waiting. With no controller this is the first install (nothing to
				// update from), so skip it - handleUpdateReady re-checks the controller.
				if (installing.state === 'installed' && navigator.serviceWorker.controller) {
					handleUpdateReady(reg);
				}
			});
		};

		const onControllerChange = (): void => {
			if (refreshingRef.current) {
				window.location.reload();
			}
		};

		navigator.serviceWorker
			.register('/sw.js', { updateViaCache: 'none' })
			.then((reg) => {
				registrationRef.current = reg;
				handleUpdateReady(reg);

				// If there's already an update downloading, watch it.
				listenForInstall(reg);

				// Watch future updates.
				reg.addEventListener('updatefound', () => {
					listenForInstall(reg);
				});
			})
			.catch((error: unknown) => {
				console.error('ServiceWorker registration failed:', error instanceof Error ? error.message : String(error));
			});

		navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

		return () => {
			navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
		};
	}, []);

	// Init offline detection, stale cache check, and restore imported tracks once on mount.
	useEffect(() => {
		initOfflineDetection();
		void initStaleCacheCheck();
		void loadImportedTracksFromStorage();
	}, [initOfflineDetection, initStaleCacheCheck, loadImportedTracksFromStorage]);

	// Launch self-heal: refresh a stale offline cache for the already-online user.
	// Gated on trailReady because the corridor GPX loads asynchronously after
	// mount - selfHealStaleTiles needs the trail points to regenerate tile URLs.
	// (The 'online' event below only fires on an offline->online transition.)
	useEffect(() => {
		if (!trailReady) return;
		void selfHealStaleTiles();
	}, [trailReady, selfHealStaleTiles]);

	// Handle TILE_QUOTA_EXCEEDED message from a service worker
	useEffect(() => {
		if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

		const handleMessage = (event: MessageEvent): void => {
			// Only act on messages from a real SW (not stray window.postMessage).
			if (!(event.source instanceof ServiceWorker)) return;
			if (event.data?.type === 'TILE_QUOTA_EXCEEDED') {
				handleQuotaExceeded();
			}
		};

		navigator.serviceWorker.addEventListener('message', handleMessage);
		return () => {
			navigator.serviceWorker.removeEventListener('message', handleMessage);
		};
	}, [handleQuotaExceeded]);

	// On reconnect: self-heal a stale offline cache (auto-sync, off battery saver)
	// and re-evaluate the predictive precache. All eligibility gating lives in the
	// store action so the trigger here stays a thin event wire-up.
	useEffect(() => {
		if (typeof window === 'undefined') return;

		const handleOnline = (): void => {
			void maybeRunPredictivePrecache({ source: 'online' });
			void selfHealStaleTiles();
		};

		window.addEventListener('online', handleOnline);
		return () => {
			window.removeEventListener('online', handleOnline);
		};
	}, [maybeRunPredictivePrecache, selfHealStaleTiles]);

	// Network type changes (Wi-Fi <-> cellular) trigger predictive checks
	useEffect(() => {
		if (typeof window === 'undefined') return;
		const conn = (navigator as NavigatorWithConnection).connection;
		if (!conn || typeof conn.addEventListener !== 'function') return;
		const handler = (): void => {
			void maybeRunPredictivePrecache({ source: 'network' });
		};
		conn.addEventListener('change', handler);
		return () => {
			conn.removeEventListener?.('change', handler); // some platforms expose addEventListener but not removeEventListener
		};
	}, [maybeRunPredictivePrecache]);

	// Battery level / charging state changes trigger predictive checks and, when
	// the device gets low while discharging, auto-enable battery saver once.
	// Battery values are read locally only and never transmitted (privacy: the API
	// is deprecated/restricted in some browsers, treated as unavailable in those).
	useEffect(() => {
		if (typeof window === 'undefined') return;
		const navWithBattery = navigator as NavigatorWithBattery;
		if (typeof navWithBattery.getBattery !== 'function') return;
		let battery: BatteryManager | null = null;
		const maybeAutoBatterySaver = (b: BatteryManager): void => {
			const low = b.level <= AUTO_BATTERY_SAVER_LEVEL && !b.charging;
			if (!low) {
				// Reset the episode so the next dip can re-apply (and respect a user
				// who manually turned it off above the threshold).
				autoBatterySaverAppliedRef.current = false;
				return;
			}
			if (autoBatterySaverAppliedRef.current) return;
			autoBatterySaverAppliedRef.current = true;
			if (!useMapStore.getState().batterySaverMode) {
				useMapStore.getState().setBatterySaverMode(true);
			}
		};
		const handler = (): void => {
			void maybeRunPredictivePrecache({ source: 'battery' });
			if (battery) maybeAutoBatterySaver(battery);
		};
		navWithBattery
			.getBattery()
			.then((b) => {
				battery = b;
				maybeAutoBatterySaver(b);
				b.addEventListener('levelchange', handler);
				b.addEventListener('chargingchange', handler);
			})
			.catch(() => {
				// getBattery rejected - battery API unavailable, skip silently.
			});
		return () => {
			battery?.removeEventListener('levelchange', handler);
			battery?.removeEventListener('chargingchange', handler);
		};
	}, [maybeRunPredictivePrecache]);

	const onUpdateNow = (): void => {
		const reg = registrationRef.current;
		if (reg?.waiting) {
			refreshingRef.current = true;
			reg.waiting.postMessage({ type: 'SKIP_WAITING' });
		} else {
			window.location.reload();
		}
	};

	return (
		<>
			{updateAvailable && (
				<div aria-label={t('updateAvailable')} className="map-tooltip map-tooltip--pwa" role="dialog">
					<div className="flex items-center gap-2">
						<IoRefresh aria-hidden className="h-4 w-4 shrink-0 opacity-80" />
						<p className="font-medium">{t('updateAvailable')}</p>
					</div>
					<div className="mt-2 flex flex-wrap items-center justify-end gap-2">
						<Button variant="mapTooltipPrimary" onClick={onUpdateNow}>
							{t('updateNow')}
						</Button>
					</div>
				</div>
			)}
			{children}
		</>
	);
}
