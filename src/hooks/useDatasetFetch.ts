'use client';

import { useEffect, useRef } from 'react';

/** Tab-focus revalidation waits this long after the last load. */
const REVALIDATE_ON_FOCUS_AFTER_MS = 5 * 60 * 1000;
/** Idle deferral: the browser runs the load when idle, at the latest after this. */
const IDLE_TIMEOUT_MS = 5000;
/** Without requestIdleCallback (Safari), the deferred load runs after this. */
const IDLE_FALLBACK_DELAY_MS = 2000;

export interface DatasetFetchOptions<T> {
	/** Loads the dataset, usually a DatasetLoader's load (src/lib/dataset-loader.ts).
	 *  A new function reloads, so callers keep it stable. */
	load: () => Promise<T | null>;
	/** Marks the loaded dataset stale before a focus revalidation; without it
	 *  the dataset is loaded once. */
	reset?: () => void;
	/** Receives every dataset that loads; a null result publishes nothing, so
	 *  the store keeps what it has. */
	onData: (data: T) => void;
	/** Runs the first load at browser idle time, off the startup path. */
	deferUntilIdle?: boolean;
}

/**
 * Loads a dataset into the store on mount and revalidates it when the tab is
 * shown again at least five minutes after the last successful load; until one
 * succeeds, every return to the tab tries again. A revalidation that finds
 * nothing new gets the same object back from the loader, which the store
 * setters pass through without republishing derived data.
 */
export function useDatasetFetch<T>({ load, reset, onData, deferUntilIdle = false }: DatasetFetchOptions<T>): void {
	/** When the last load returned data; kept across effect re-runs, so only the
	 *  first load is deferred and the focus throttle survives a new `load`. */
	const lastLoadedAtRef = useRef(0);

	useEffect(() => {
		if (typeof window === 'undefined') return;
		let cancelled = false;

		const run = async (): Promise<void> => {
			try {
				const data = await load();
				if (data === null) return;
				lastLoadedAtRef.current = Date.now();
				if (!cancelled) onData(data);
			} catch {
				// The store keeps what it has.
			}
		};

		let idleHandle: number | null = null;
		let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
		/** The deferred first load has not started; a return to the tab must not
		 *  pull it onto the startup path. */
		let firstLoadDeferred = false;
		if (deferUntilIdle && lastLoadedAtRef.current === 0) {
			firstLoadDeferred = true;
			const runDeferred = (): void => {
				firstLoadDeferred = false;
				void run();
			};
			if ('requestIdleCallback' in window) {
				idleHandle = window.requestIdleCallback(runDeferred, { timeout: IDLE_TIMEOUT_MS });
			} else {
				timeoutHandle = setTimeout(runDeferred, IDLE_FALLBACK_DELAY_MS);
			}
		} else {
			void run();
		}

		const onVisibility = (): void => {
			if (!reset || firstLoadDeferred || document.visibilityState !== 'visible') return;
			if (Date.now() - lastLoadedAtRef.current < REVALIDATE_ON_FOCUS_AFTER_MS) return;
			reset();
			void run();
		};
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			cancelled = true;
			document.removeEventListener('visibilitychange', onVisibility);
			if (idleHandle !== null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleHandle);
			if (timeoutHandle !== null) clearTimeout(timeoutHandle);
		};
	}, [load, reset, onData, deferUntilIdle]);
}
