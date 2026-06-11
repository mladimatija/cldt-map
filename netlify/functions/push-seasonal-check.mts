/**
 * Scheduled check (hourly) for new seasonal-status entries; sends a web push
 * notification for entries not seen on the previous run.
 *
 * State is one blob ("push-state"/"seen-seasonal-ids") holding the entry ids
 * already notified, so a redeploy never re-notifies the whole dataset: on
 * first run (no state) the current ids are recorded without sending.
 * Subscriptions that the push service reports as gone (404/410) are pruned.
 */

import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import webpush from 'web-push';

const SITE_URL = process.env.URL ?? 'https://map.cldt.hr';

interface SeasonalEntry {
	id: string;
	severity?: string;
	title_en?: string;
	title_hr?: string;
}

export default async function handler(): Promise<Response> {
	const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
	const privateKey = process.env.VAPID_PRIVATE_KEY;
	if (!publicKey || !privateKey) return new Response('push not configured', { status: 200 });
	webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:matija.culjak@gmail.com', publicKey, privateKey);

	const res = await fetch(`${SITE_URL}/seasonal-status.json`, { cache: 'no-store' });
	if (!res.ok) return new Response('seasonal fetch failed', { status: 200 });
	const file = (await res.json()) as { entries?: SeasonalEntry[] };
	const entries = (file.entries ?? []).filter((e) => typeof e.id === 'string');
	const currentIds = entries.map((e) => e.id);

	const stateStore = getStore('push-state');
	const seen = (await stateStore.get('seen-seasonal-ids', { type: 'json' })) as string[] | null;
	await stateStore.setJSON('seen-seasonal-ids', currentIds);

	// First run: baseline only, never blast the whole dataset.
	if (seen === null) return new Response('baseline recorded', { status: 200 });

	const seenSet = new Set(seen);
	const fresh = entries.filter((e) => !seenSet.has(e.id));
	if (fresh.length === 0) return new Response('no new entries', { status: 200 });

	const subsStore = getStore('push-subscriptions');
	const { blobs } = await subsStore.list();
	if (blobs.length === 0) return new Response('no subscribers', { status: 200 });

	const title =
		fresh.length === 1
			? (fresh[0].title_en ?? fresh[0].title_hr ?? 'New trail warning')
			: `${fresh.length} new trail warnings`;
	const payload = JSON.stringify({
		title: `CLDT Map: ${title}`,
		body: fresh
			.slice(0, 3)
			.map((e) => `[${e.severity ?? 'info'}] ${e.title_en ?? e.title_hr ?? e.id}`)
			.join('\n'),
		url: `${SITE_URL}/`,
	});

	let sent = 0;
	for (const blob of blobs) {
		const sub = (await subsStore.get(blob.key, { type: 'json' })) as {
			endpoint: string;
			keys: { p256dh: string; auth: string };
		} | null;
		if (!sub) continue;
		try {
			await webpush.sendNotification(sub, payload, { TTL: 6 * 3600 });
			sent++;
		} catch (err) {
			const status = (err as { statusCode?: number }).statusCode;
			if (status === 404 || status === 410) await subsStore.delete(blob.key);
		}
	}
	return new Response(`sent ${sent}/${blobs.length} for ${fresh.length} new entries`, { status: 200 });
}

export const config: Config = {
	schedule: '@hourly',
};
