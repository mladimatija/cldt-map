/**
 * Client side of trail-alert web push opt-in (seasonal warnings + condition notices).
 *
 * The deploy is the source of capability (VAPID public key baked in at
 * build time; subscribe endpoint answers 503 when the private half is not
 * configured), the browser subscription is the source of truth for "on".
 * All failures resolve to `false` so the settings toggle can simply revert.
 */

const SUBSCRIBE_ENDPOINT = '/.netlify/functions/push-subscribe';
/** The UI language last sent with the subscription; notifications use it. */
const SYNCED_LOCALE_KEY = 'cldt-push-locale';

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

function postSubscription(subscription: PushSubscription, locale: string): Promise<Response> {
	return fetch(SUBSCRIBE_ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ ...subscription.toJSON(), locale }),
	});
}

function rememberSyncedLocale(locale: string | null): void {
	try {
		if (locale) localStorage.setItem(SYNCED_LOCALE_KEY, locale);
		else localStorage.removeItem(SYNCED_LOCALE_KEY);
	} catch {
		// storage unavailable: the next sync just posts again
	}
}

/** Must run inside a user gesture (permission prompt). `locale` is the UI
 *  language the notifications are written in. */
export async function enablePushAlerts(locale: string): Promise<boolean> {
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
		const res = await postSubscription(subscription, locale);
		if (res.ok) rememberSyncedLocale(locale);
		return res.ok;
	} catch {
		return false;
	}
}

/** Re-sends an existing subscription when the UI language changed since it
 *  was last sent (or was never sent, for subscriptions from older builds), so
 *  notifications follow the language. Best-effort; never prompts. */
export async function syncPushAlertsLocale(locale: string): Promise<void> {
	if (!pushAlertsSupported()) return;
	try {
		if (localStorage.getItem(SYNCED_LOCALE_KEY) === locale) return;
		const registration = await navigator.serviceWorker.ready;
		const subscription = await registration.pushManager.getSubscription();
		if (!subscription) return;
		if ((await postSubscription(subscription, locale)).ok) rememberSyncedLocale(locale);
	} catch {
		// best-effort; the next language change or app start tries again
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
		rememberSyncedLocale(null);
	} catch {
		// best-effort; the scheduled sender prunes dead subscriptions anyway
	}
}
