'use client';

import React, { useEffect, useState } from 'react';
import { IoRefresh } from 'react-icons/io5';

interface ServiceWorkerProviderProps {
	children: React.ReactNode;
}

/**
 * Provider that manages service worker registration and updates
 */
export function ServiceWorkerProvider({ children }: ServiceWorkerProviderProps): React.ReactElement {
	const [updateAvailable, setUpdateAvailable] = useState(false);

	// Only run service worker logic on the client side
	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}

		let registration: ServiceWorkerRegistration | null = null;
		const handleUpdate = (reg: ServiceWorkerRegistration): void => {
			if (reg.waiting) {
				setUpdateAvailable(true);
			}
		};

		const onLoad = (): void => {
			if (!('serviceWorker' in navigator)) {
				return;
			}
			if (process.env.NODE_ENV === 'development') {
				return;
			}
			navigator.serviceWorker
				.register('/sw.js')
				.then((reg) => {
					registration = reg;
					reg.addEventListener('updatefound', onUpdateFound);
				})
				.catch((error) => {
					console.error('ServiceWorker registration failed:', error);
				});
		};

		const onUpdateFound = (): void => {
			if (registration) {
				handleUpdate(registration);
			}
		};

		window.addEventListener('load', onLoad);
		if (document.readyState === 'complete') {
			onLoad();
		}

		return () => {
			window.removeEventListener('load', onLoad);
			if (registration) {
				registration.removeEventListener('updatefound', onUpdateFound);
			}
		};
	}, []);

	return (
		<>
			{updateAvailable && (
				<div className="z-toast fixed right-4 bottom-4 rounded-md bg-blue-600 p-4 text-white shadow-lg">
					<div className="flex items-center gap-2">
						<IoRefresh className="h-5 w-5" />
						<p>New version available!</p>
					</div>
					<button
						className="mt-2 flex w-full items-center justify-center rounded-md bg-white px-4 py-1 text-blue-600"
						onClick={() => window.location.reload()}
					>
						<span>Update now</span>
					</button>
				</div>
			)}
			{children}
		</>
	);
}
