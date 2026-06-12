'use client';

/**
 * Main-thread client for the trail computation worker. Spawns a one-shot
 * worker per call (the trail loads once per session; keeping a warm worker
 * alive would only hold its heap) and resolves with the computed dataset,
 * or rejects so the caller can fall back to the synchronous path.
 */

import type { ComputedTrailData } from './trail-compute';
import type { TrailDirection } from './store/types';

const WORKER_TIMEOUT_MS = 20_000;

type WorkerResponse = { ok: true; payload: ComputedTrailData } | { ok: false; error: string };

export function computeTrailDataInWorker(gpxText: string, direction: TrailDirection): Promise<ComputedTrailData> {
	return new Promise((resolve, reject) => {
		if (typeof window === 'undefined' || typeof Worker === 'undefined') {
			reject(new Error('workers unavailable'));
			return;
		}
		let worker: Worker;
		try {
			worker = new Worker(new URL('../workers/trail-compute.worker.ts', import.meta.url));
		} catch (err) {
			reject(err instanceof Error ? err : new Error('worker construction failed'));
			return;
		}
		const timeout = setTimeout(() => {
			worker.terminate();
			reject(new Error('trail worker timed out'));
		}, WORKER_TIMEOUT_MS);
		worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
			clearTimeout(timeout);
			worker.terminate();
			if (event.data.ok) resolve(event.data.payload);
			else reject(new Error(event.data.error));
		};
		worker.onerror = (event) => {
			clearTimeout(timeout);
			worker.terminate();
			reject(new Error(event.message || 'trail worker error'));
		};
		worker.postMessage({ gpxText, direction });
	});
}
