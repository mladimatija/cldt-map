// Retry-aware POST helper for the Overpass API.
//
// The public Overpass instance enforces concurrent-slot quotas per IP and will
// answer 429 when slots are exhausted, or 502/503/504 when its gateway times
// out. These are transient: backing off briefly and retrying succeeds in the
// common case. This helper wraps a single request with bounded exponential
// backoff and honors the Retry-After header when Overpass sets it.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_ATTEMPTS = 4;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

const STATUS_BACKOFF_MS_429 = [15_000, 30_000, 60_000];
const STATUS_BACKOFF_MS_5XX = [5_000, 15_000, 30_000];
const NETWORK_BACKOFF_MS = [3_000, 10_000, 30_000];

export interface FetchOverpassOptions {
	url: string;
	/** Mirrors tried in order after `url` exhausts its attempts. Public
	 *  Overpass instances fail independently (different operators, different
	 *  load), so a busy primary rarely implies a busy fallback. */
	fallbackUrls?: string[];
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
 * bounded backoff, then failing over to each mirror in `fallbackUrls` with the
 * same retry budget. Returns the successful Response (body not yet consumed).
 * Throws the last endpoint's OverpassFetchError when every endpoint is
 * exhausted; terminal statuses (4xx other than 429) skip straight to the next
 * endpoint since retrying them locally cannot succeed.
 */
export async function fetchOverpass(opts: FetchOverpassOptions): Promise<Response> {
	const endpoints = [opts.url, ...(opts.fallbackUrls ?? [])];
	let lastError: OverpassFetchError | undefined;
	for (let i = 0; i < endpoints.length; i++) {
		try {
			return await fetchOverpassFromEndpoint({ ...opts, url: endpoints[i] }, async (res) => res);
		} catch (err) {
			lastError = err instanceof OverpassFetchError ? err : new OverpassFetchError((err as Error).message);
			const next = endpoints[i + 1];
			if (next) {
				opts.onRetry?.({
					attempt: 0,
					nextAttempt: 1,
					status: lastError.status ?? 'network',
					waitMs: 0,
					message: `${endpoints[i]} exhausted (${lastError.message}); failing over to ${next}`,
				});
			}
		}
	}
	throw lastError ?? new OverpassFetchError('no Overpass endpoints configured');
}

/**
 * Like fetchOverpass, but consumes the body and returns parsed JSON, treating
 * Overpass "runtime error" remarks as retryable failures. Overpass reports
 * server-side query timeouts and memory exhaustion as HTTP 200 with a
 * `remark` field and empty/partial elements - callers that only check the
 * HTTP status read those as legitimate empty results (this is exactly how
 * the reachability pass once built a 0-node highway graph and dropped 7,000
 * POIs without a single error). The remark check runs inside the attempt
 * loop, so a remark-timeout backs off, retries, and fails over like a 504.
 */
export async function fetchOverpassJson<T extends { remark?: string }>(opts: FetchOverpassOptions): Promise<T> {
	const endpoints = [opts.url, ...(opts.fallbackUrls ?? [])];
	let lastError: OverpassFetchError | undefined;
	for (let i = 0; i < endpoints.length; i++) {
		try {
			return await fetchOverpassFromEndpoint({ ...opts, url: endpoints[i] }, async (res) => {
				const json = (await res.json()) as T;
				if (typeof json.remark === 'string' && /error/i.test(json.remark)) {
					throw new OverpassRemarkError(`Overpass remark: ${json.remark}`);
				}
				return json;
			});
		} catch (err) {
			lastError = err instanceof OverpassFetchError ? err : new OverpassFetchError((err as Error).message);
			const next = endpoints[i + 1];
			if (next) {
				opts.onRetry?.({
					attempt: 0,
					nextAttempt: 1,
					status: lastError.status ?? 'network',
					waitMs: 0,
					message: `${endpoints[i]} exhausted (${lastError.message}); failing over to ${next}`,
				});
			}
		}
	}
	throw lastError ?? new OverpassFetchError('no Overpass endpoints configured');
}

/** Internal marker: a 200 response whose body carries an Overpass runtime
 *  error remark. Retryable, unlike other OverpassFetchErrors. */
class OverpassRemarkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OverpassRemarkError';
	}
}

async function fetchOverpassFromEndpoint<T>(
	opts: FetchOverpassOptions,
	accept: (res: Response) => Promise<T>,
): Promise<T> {
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
			if (res.ok) {
				try {
					return await accept(res);
				} catch (err) {
					if (!(err instanceof OverpassRemarkError) || attempt === maxAttempts) {
						throw new OverpassFetchError((err as Error).message);
					}
					// Remark-style runtime error: back off like a 5xx and retry.
					const waitMs = STATUS_BACKOFF_MS_5XX[Math.min(attempt - 1, STATUS_BACKOFF_MS_5XX.length - 1)];
					opts.onRetry?.({
						attempt,
						nextAttempt: attempt + 1,
						status: 'network',
						waitMs,
						message: `${err.message}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`,
					});
					await sleep(waitMs);
					continue;
				}
			}

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

// ---- Shared on-disk result cache --------------------------------------------
// Used by the enrichment scripts so a rerun after a partial failure only
// refetches the queries that actually failed. Keyed on the full query text;
// any input change (selectors, radius, trail geometry) misses naturally.

export interface OverpassCacheOptions {
	dir: string;
	ttlMs: number;
	disabled?: boolean;
}

export function overpassCacheFile(opts: OverpassCacheOptions, label: string, queryText: string): string {
	const hash = createHash('sha1').update(queryText).digest('hex').slice(0, 12);
	return path.join(opts.dir, `${label}-${hash}.json`);
}

export async function readOverpassJsonCache<T>(file: string, opts: OverpassCacheOptions): Promise<T | null> {
	if (opts.disabled) return null;
	try {
		const raw = JSON.parse(await fs.readFile(file, 'utf8')) as { fetchedAt?: number; data?: T };
		if (typeof raw.fetchedAt !== 'number' || raw.data === undefined) return null;
		if (Date.now() - raw.fetchedAt > opts.ttlMs) return null;
		return raw.data;
	} catch {
		return null;
	}
}

export async function writeOverpassJsonCache<T>(file: string, data: T, opts: OverpassCacheOptions): Promise<void> {
	if (opts.disabled) return;
	try {
		await fs.mkdir(opts.dir, { recursive: true });
		await fs.writeFile(file, JSON.stringify({ fetchedAt: Date.now(), data }));
	} catch (err) {
		console.warn(`     cache write failed (${(err as Error).message}); continuing without cache.`);
	}
}
