// Retry-aware POST helper for the Overpass API.
//
// The public Overpass instance enforces concurrent-slot quotas per IP and will
// answer 429 when slots are exhausted, or 502/503/504 when its gateway times
// out. These are transient: backing off briefly and retrying succeeds in the
// common case. This helper wraps a single request with bounded exponential
// backoff and honors the Retry-After header when Overpass sets it.

const DEFAULT_MAX_ATTEMPTS = 4;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

const STATUS_BACKOFF_MS_429 = [15_000, 30_000, 60_000];
const STATUS_BACKOFF_MS_5XX = [5_000, 15_000, 30_000];
const NETWORK_BACKOFF_MS = [3_000, 10_000, 30_000];

export interface FetchOverpassOptions {
	url: string;
	/** Already URL-encoded request body, e.g. `data=${encodeURIComponent(query)}`. */
	body: string;
	userAgent: string;
	/** Per-attempt fetch timeout. */
	fetchTimeoutMs: number;
	maxAttempts?: number;
	/** Called before each backoff sleep so callers can surface retry progress. */
	onRetry?: (info: RetryInfo) => void;
}

export interface RetryInfo {
	attempt: number;
	nextAttempt: number;
	status: number | 'network';
	waitMs: number;
	message: string;
}

export class OverpassFetchError extends Error {
	readonly status?: number;
	constructor(message: string, status?: number) {
		super(message);
		this.name = 'OverpassFetchError';
		this.status = status;
	}
}

/**
 * POSTs an Overpass query, retrying 429/5xx and transient network errors with
 * bounded backoff. Returns the successful Response (body not yet consumed).
 * Throws OverpassFetchError after retries are exhausted or on a terminal
 * status (e.g., 4xx other than 429).
 */
export async function fetchOverpass(opts: FetchOverpassOptions): Promise<Response> {
	const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	let lastNetworkErr: Error | undefined;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), opts.fetchTimeoutMs);
		try {
			const res = await fetch(opts.url, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': opts.userAgent },
				body: opts.body,
				signal: controller.signal,
			});
			clearTimeout(timer);
			if (res.ok) return res;

			const status = res.status;
			if (!RETRYABLE_STATUSES.has(status) || attempt === maxAttempts) {
				throw new OverpassFetchError(`Overpass returned HTTP ${status}`, status);
			}

			const waitMs = backoffForStatus(res, attempt);
			opts.onRetry?.({
				attempt,
				nextAttempt: attempt + 1,
				status,
				waitMs,
				message: `HTTP ${status}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`,
			});
			await sleep(waitMs);
		} catch (err) {
			clearTimeout(timer);
			if (err instanceof OverpassFetchError) throw err;
			if (attempt === maxAttempts) {
				throw new OverpassFetchError(`network error after ${attempt} attempts: ${(err as Error).message}`);
			}
			lastNetworkErr = err as Error;
			const waitMs = NETWORK_BACKOFF_MS[Math.min(attempt - 1, NETWORK_BACKOFF_MS.length - 1)];
			opts.onRetry?.({
				attempt,
				nextAttempt: attempt + 1,
				status: 'network',
				waitMs,
				message: `${(err as Error).message}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`,
			});
			await sleep(waitMs);
		}
	}

	throw new OverpassFetchError(`exhausted ${maxAttempts} attempts: ${lastNetworkErr?.message ?? 'unknown'}`);
}

function backoffForStatus(res: Response, attempt: number): number {
	const retryAfter = res.headers.get('retry-after');
	if (retryAfter) {
		const seconds = parseRetryAfter(retryAfter);
		if (seconds !== null) return Math.max(1_000, seconds * 1_000);
	}
	const table = res.status === 429 ? STATUS_BACKOFF_MS_429 : STATUS_BACKOFF_MS_5XX;
	return table[Math.min(attempt - 1, table.length - 1)];
}

function parseRetryAfter(header: string): number | null {
	const trimmed = header.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed);
	const dateMs = Date.parse(trimmed);
	if (Number.isNaN(dateMs)) return null;
	return Math.max(0, Math.round((dateMs - Date.now()) / 1000));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
