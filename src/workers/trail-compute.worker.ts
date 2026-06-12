/**
 * Trail computation Web Worker: parses the GPX and builds the enhanced
 * trail dataset off the main thread. One job per message; the client
 * terminates the worker after the response, so no lifecycle state lives
 * here.
 */

import { computeFromGpx } from '@/lib/trail-compute';
import type { TrailDirection } from '@/lib/store/types';

export interface TrailWorkerRequest {
	gpxText: string;
	direction: TrailDirection;
}

self.onmessage = (event: MessageEvent<TrailWorkerRequest>) => {
	try {
		const { gpxText, direction } = event.data;
		const payload = computeFromGpx(gpxText, direction);
		self.postMessage({ ok: true as const, payload });
	} catch (error) {
		self.postMessage({ ok: false as const, error: error instanceof Error ? error.message : 'worker failure' });
	}
};
