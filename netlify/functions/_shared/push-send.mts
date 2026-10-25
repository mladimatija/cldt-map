import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

export type PushSubscription = {
	endpoint: string;
	keys: { p256dh: string; auth: string };
	/** UI language at subscribe time; notifications are written in it. */
	locale?: string;
};

export interface PushPayload {
	title: string;
	body: string;
	url: string;
}

/** Subscriptions sent to concurrently: bounded, so one run never opens hundreds of sockets. */
const SEND_BATCH_SIZE = 20;

export function configureVapid(): boolean {
	const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
	const privateKey = process.env.VAPID_PRIVATE_KEY;
	if (!publicKey || !privateKey) return false;
	webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:matija.culjak@gmail.com', publicKey, privateKey);
	return true;
}

/** Sends to every stored subscription, in each subscriber's locale. Pages
 *  through the store, sends in batches, and prunes subscriptions the push
 *  service reports as gone (404/410). */
export async function sendToAllSubscribers(
	buildPayload: (locale: string) => PushPayload,
): Promise<{ sent: number; total: number }> {
	const subsStore = getStore('push-subscriptions');
	const payloads = new Map<string, string>();
	const payloadFor = (locale: string): string => {
		let payload = payloads.get(locale);
		if (!payload) {
			payload = JSON.stringify(buildPayload(locale));
			payloads.set(locale, payload);
		}
		return payload;
	};

	let sent = 0;
	let total = 0;
	for await (const page of subsStore.list({ paginate: true })) {
		for (let i = 0; i < page.blobs.length; i += SEND_BATCH_SIZE) {
			const batch = page.blobs.slice(i, i + SEND_BATCH_SIZE);
			total += batch.length;
			const results = await Promise.allSettled(
				batch.map(async (blob) => {
					const sub = (await subsStore.get(blob.key, { type: 'json' })) as PushSubscription | null;
					if (!sub) return false;
					try {
						await webpush.sendNotification(sub, payloadFor(sub.locale ?? 'en'), { TTL: 6 * 3600 });
						return true;
					} catch (err) {
						const status = (err as { statusCode?: number }).statusCode;
						if (status === 404 || status === 410) await subsStore.delete(blob.key);
						return false;
					}
				}),
			);
			sent += results.filter((r) => r.status === 'fulfilled' && r.value).length;
		}
	}
	return { sent, total };
}
