'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { IoRefresh } from 'react-icons/io5';
import { Button } from '@/components/ui/Button';

interface ServiceWorkerProviderProps {
	children: React.ReactNode;
}

/**
 * Provider that manages service worker registration and updates
 */
export function ServiceWorkerProvider({ children }: ServiceWorkerProviderProps): React.ReactElement {
	const t = useTranslations('serviceWorker');
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
	const refreshingRef = useRef(false);

	// Only run service worker logic on the client side
	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}

		if (!('serviceWorker' in navigator)) return;
		if (process.env.NODE_ENV === 'development') return;

		const handleUpdateReady = (reg: ServiceWorkerRegistration): void => {
			registrationRef.current = reg;
			if (reg.waiting) setUpdateAvailable(true);
		};

		const listenForInstall = (reg: ServiceWorkerRegistration): void => {
			const installing = reg.installing;
			if (!installing) return;
			installing.addEventListener('statechange', () => {
				// "installed" means it's in waiting if there's an existing controller.
				if (installing.state === 'installed') {
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
			.catch((error) => {
				console.error('ServiceWorker registration failed:', error);
			});

		navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

		return () => {
			navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
		};
	}, []);

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
					<div className="map-tooltip__actions">
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
