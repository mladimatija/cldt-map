/**
 * Push subscription registry: POST stores a browser PushSubscription, DELETE
 * removes it. Subscriptions live in Netlify Blobs ("push-subscriptions"
 * store), keyed by a SHA-256 of the endpoint URL so re-subscribes overwrite
 * instead of duplicating. No accounts, no personal data - a subscription is
 * an opaque push endpoint plus its encryption keys, and the UI language the
 * notifications are written in.
 *
 * Only endpoints on the browsers' push services are accepted, so the store
 * cannot be filled with arbitrary hosts the scheduled checks would then POST
 * to. Requests are rate-limited per client like the app's API routes.
 *
 * Returns 503 when web push is not configured for the deploy (missing VAPID
 * env), so the client can hide the toggle's effect gracefully.
 */

import { getStore } from '@netlify/blobs';
import { getClientIp, isRateLimited } from '../../src/lib/rate-limit-core';
import { PUSH_LOCALES } from './_shared/push-i18n.mts';

const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 256;

/** Push service hosts of the major browsers (Chrome/Edge via FCM, Firefox,
 *  Windows, Safari): exact names, and suffixes for the sharded ones. */
const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const PUSH_HOST_SUFFIXES = ['.notify.windows.com', '.push.apple.com'];

interface StoredSubscription {
	endpoint: string;
	keys: { p256dh: string; auth: string };
	locale?: string;
}

function isPushServiceEndpoint(endpoint: string): boolean {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return false;
	}
	if (url.protocol !== 'https:') return false;
	return PUSH_HOSTS.has(url.hostname) || PUSH_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix));
}

function isSubscription(o: unknown): o is StoredSubscription {
	const s = o as StoredSubscription | null;
	return (
		!!s &&
		typeof s.endpoint === 'string' &&
		s.endpoint.length <= MAX_ENDPOINT_LENGTH &&
		isPushServiceEndpoint(s.endpoint) &&
		typeof s.keys?.p256dh === 'string' &&
		s.keys.p256dh.length <= MAX_KEY_LENGTH &&
		typeof s.keys?.auth === 'string' &&
		s.keys.auth.length <= MAX_KEY_LENGTH
	);
}

async function endpointKey(endpoint: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
	const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `sub-${hex}`;
}

/** The key older builds used (djb2 plus length), which could collide.
 *  Deleted on the next subscribe or unsubscribe of the same endpoint. */
function legacyEndpointKey(endpoint: string): string {
	let h = 5381;
	for (let i = 0; i < endpoint.length; i++) h = ((h << 5) + h + endpoint.charCodeAt(i)) >>> 0;
	return `sub-${h.toString(36)}-${endpoint.length}`;
}

export default async function handler(req: Request): Promise<Response> {
	if (!process.env.VAPID_PRIVATE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
		return new Response('push not configured', { status: 503 });
	}
	if (req.method !== 'POST' && req.method !== 'DELETE') {
		return new Response('method not allowed', { status: 405 });
	}
	if (await isRateLimited(getClientIp(req.headers), { name: 'push-subscribe', windowMs: 3_600_000, max: 20 })) {
		return new Response('rate limit exceeded', { status: 429, headers: { 'Retry-After': '3600' } });
	}

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return new Response('bad request', { status: 400 });
	}
	if (!isSubscription(body)) return new Response('bad request', { status: 400 });

	const store = getStore('push-subscriptions');
	const key = await endpointKey(body.endpoint);
	const legacyKey = legacyEndpointKey(body.endpoint);
	if (req.method === 'POST') {
		const locale = typeof body.locale === 'string' && PUSH_LOCALES.has(body.locale) ? body.locale : 'en';
		await store.setJSON(key, { endpoint: body.endpoint, keys: body.keys, locale });
		await store.delete(legacyKey);
		return new Response('ok', { status: 201 });
	}
	await Promise.all([store.delete(key), store.delete(legacyKey)]);
	return new Response('ok', { status: 200 });
}
