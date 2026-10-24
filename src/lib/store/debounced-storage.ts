import type { PersistStorage, StorageValue } from 'zustand/middleware';

/** Trailing delay after the last change before a write. */
const TRAILING_MS = 400;
/** Longest a change may wait during a continuous burst (GPS fixes, tile batches). */
const MAX_WAIT_MS = 2000;

/** Flush functions of every debounced storage, for page hide and deliberate reloads. */
const flushers = new Set<() => void>();
let pageHideListenersInstalled = false;

/** Writes every queued persisted-store value now. Call before a deliberate reload. */
export function flushPersistedStores(): void {
	for (const flush of flushers) flush();
}

function installPageHideListeners(): void {
	if (pageHideListenersInstalled || typeof window === 'undefined') return;
	pageHideListenersInstalled = true;
	// pagehide covers reloads and navigation; visibilitychange covers mobile
	// browsers that background or kill the tab without firing pagehide.
	window.addEventListener('pagehide', flushPersistedStores);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') flushPersistedStores();
	});
}

/**
 * zustand `PersistStorage` over localStorage that coalesces writes. zustand's
 * persist middleware serializes and writes the whole persisted state on EVERY
 * `set`, including changes to fields that are not persisted (hover ids, GPS
 * fixes, tile-download progress, radar frames). This keeps only the latest
 * value, writes it once after a quiet period (or at most every 2 s during a
 * burst), skips the write when the JSON is unchanged, and flushes when the
 * page is hidden so nothing is lost on close.
 */
export function createDebouncedJsonStorage<S>(
	getStorage: () => Storage = () => window.localStorage,
): PersistStorage<S> | undefined {
	let storage: Storage;
	try {
		storage = getStorage();
	} catch {
		// No storage (SSR, or blocked by the browser): persist runs without it.
		return undefined;
	}

	const pending = new Map<string, StorageValue<S>>();
	const lastWritten = new Map<string, string>();
	let timer: ReturnType<typeof setTimeout> | null = null;
	let burstStartedAt = 0;

	const flush = (): void => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		for (const [name, value] of pending) {
			const json = JSON.stringify(value);
			if (lastWritten.get(name) === json) continue;
			try {
				storage.setItem(name, json);
				lastWritten.set(name, json);
			} catch (error) {
				// Quota or private-mode failures: keep the app running on in-memory state.
				console.warn(`[persist] could not save "${name}"`, error);
			}
		}
		pending.clear();
	};
	flushers.add(flush);
	installPageHideListeners();

	return {
		getItem: (name) => {
			const queued = pending.get(name);
			if (queued) return queued;
			const raw = storage.getItem(name);
			if (raw === null) return null;
			lastWritten.set(name, raw);
			return JSON.parse(raw) as StorageValue<S>;
		},
		setItem: (name, value) => {
			const now = Date.now();
			if (pending.size === 0) burstStartedAt = now;
			pending.set(name, value);
			if (timer) clearTimeout(timer);
			timer = setTimeout(flush, Math.max(0, Math.min(TRAILING_MS, burstStartedAt + MAX_WAIT_MS - now)));
		},
		removeItem: (name) => {
			pending.delete(name);
			lastWritten.delete(name);
			storage.removeItem(name);
		},
	};
}
