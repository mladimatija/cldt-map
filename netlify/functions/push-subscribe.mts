/**
 * Push subscription registry: POST stores a browser PushSubscription, DELETE
 * removes it. Subscriptions live in Netlify Blobs ("push-subscriptions"
 * store), keyed by a hash of the endpoint URL so re-subscribes overwrite
 * instead of duplicating. No accounts, no personal data - a subscription is
 * an opaque push endpoint plus its encryption keys.
 *
 * Returns 503 when web push is not configured for the deploy (missing VAPID
 * env), so the client can hide the toggle's effect gracefully.
 */

import { getStore } from '@netlify/blobs';

/** djb2 - tiny, stable, good enough for a registry key. */
function endpointKey(endpoint: string): string {
	let h = 5381;
	for (let i = 0; i < endpoint.length; i++) h = ((h << 5) + h + endpoint.charCodeAt(i)) >>> 0;
	return `sub-${h.toString(36)}-${endpoint.length}`;
}

interface StoredSubscription {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}

function isSubscription(o: unknown): o is StoredSubscription {
	const s = o as StoredSubscription | null;
	return (
		!!s &&
		typeof s.endpoint === 'string' &&
		s.endpoint.startsWith('https://') &&
		typeof s.keys?.p256dh === 'string' &&
		typeof s.keys?.auth === 'string'
	);
}

export default async function handler(req: Request): Promise<Response> {
	if (!process.env.VAPID_PRIVATE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
		return new Response('push not configured', { status: 503 });
	}
	if (req.method !== 'POST' && req.method !== 'DELETE') {
		return new Response('method not allowed', { status: 405 });
	}

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return new Response('bad request', { status: 400 });
	}
	if (!isSubscription(body)) return new Response('bad request', { status: 400 });

	const store = getStore('push-subscriptions');
	const key = endpointKey(body.endpoint);
	if (req.method === 'POST') {
		await store.setJSON(key, { endpoint: body.endpoint, keys: body.keys });
		return new Response('ok', { status: 201 });
	}
	await store.delete(key);
	return new Response('ok', { status: 200 });
}
