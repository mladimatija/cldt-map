import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

export type PushSubscription = {
	endpoint: string;
	keys: { p256dh: string; auth: string };
};

export function configureVapid(): boolean {
	const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
	const privateKey = process.env.VAPID_PRIVATE_KEY;
	if (!publicKey || !privateKey) return false;
	webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:matija.culjak@gmail.com', publicKey, privateKey);
	return true;
}

export async function sendToAllSubscribers(payload: string): Promise<{ sent: number; total: number }> {
	const subsStore = getStore('push-subscriptions');
	const { blobs } = await subsStore.list();
	let sent = 0;
	for (const blob of blobs) {
		const sub = (await subsStore.get(blob.key, { type: 'json' })) as PushSubscription | null;
		if (!sub) continue;
		try {
			await webpush.sendNotification(sub, payload, { TTL: 6 * 3600 });
			sent++;
		} catch (err) {
			const status = (err as { statusCode?: number }).statusCode;
			if (status === 404 || status === 410) await subsStore.delete(blob.key);
		}
	}
	return { sent, total: blobs.length };
}
