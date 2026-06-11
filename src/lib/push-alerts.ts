/**
 * Client side of the seasonal-alert web push opt-in.
 *
 * The deploy is the source of capability (VAPID public key baked in at
 * build time; subscribe endpoint answers 503 when the private half is not
 * configured), the browser subscription is the source of truth for "on".
 * All failures resolve to `false` so the settings toggle can simply revert.
 */

const SUBSCRIBE_ENDPOINT = '/.netlify/functions/push-subscribe';

export function pushAlertsSupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window &&
		Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
	);
}

/** Web push requires the VAPID key as a BufferSource applicationServerKey.
 *  Typed against a plain ArrayBuffer-backed view to satisfy TS 5.7's stricter
 *  ArrayBufferLike split. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
	const padding = '='.repeat((4 - (base64.length % 4)) % 4);
	const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(normalized);
	const out = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

/** Must run inside a user gesture (permission prompt). */
export async function enablePushAlerts(): Promise<boolean> {
	if (!pushAlertsSupported()) return false;
	try {
		if ((await Notification.requestPermission()) !== 'granted') return false;
		const registration = await navigator.serviceWorker.ready;
		const subscription =
			(await registration.pushManager.getSubscription()) ??
			(await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string),
			}));
		const res = await fetch(SUBSCRIBE_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(subscription.toJSON()),
		});
		return res.ok;
	} catch {
		return false;
	}
}

export async function disablePushAlerts(): Promise<void> {
	try {
		const registration = await navigator.serviceWorker.ready;
		const subscription = await registration.pushManager.getSubscription();
		if (!subscription) return;
		await fetch(SUBSCRIBE_ENDPOINT, {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(subscription.toJSON()),
		}).catch(() => undefined);
		await subscription.unsubscribe();
	} catch {
		// best-effort; the scheduled sender prunes dead subscriptions anyway
	}
}
