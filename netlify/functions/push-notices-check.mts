/**
 * Scheduled check (hourly) for new trail condition notices; sends a web push
 * notification for entries not seen on the previous run.
 *
 * State is one blob ("push-state"/"seen-notice-ids") holding the notice ids
 * already notified, so a redeploy never re-notifies the whole dataset: on
 * first non-empty fetch (no state) the current ids are recorded without sending.
 * An empty feed on first run does not persist a baseline (avoids blasting when
 * notices appear later). Subscriptions that the push service reports as gone
 * (404/410) are pruned.
 */

import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { configureVapid, sendToAllSubscribers } from './_shared/push-send.mts';

const SITE_URL = process.env.URL ?? 'https://map.cldt.hr';

type LocalizedString = string | ({ default: string } & Record<string, string>);

interface TrailNotice {
	id: string;
	severity?: string;
	title?: LocalizedString;
	expiresAt?: string;
}

function resolveLocalized(value: LocalizedString | undefined, locale = 'en'): string {
	if (!value) return '';
	if (typeof value === 'string') return value;
	return value[locale] ?? value.default;
}

function filterActiveNotices(notices: TrailNotice[], now = new Date()): TrailNotice[] {
	return notices.filter((n) => !n.expiresAt || new Date(n.expiresAt) > now);
}

async function fetchNotices(): Promise<TrailNotice[] | null> {
	const remoteUrl = process.env.NEXT_PUBLIC_NOTICES_URL;
	if (remoteUrl) {
		try {
			const res = await fetch(remoteUrl, { cache: 'no-store' });
			if (res.ok) {
				const file = (await res.json()) as { notices?: TrailNotice[] };
				return filterActiveNotices((file.notices ?? []).filter((n) => typeof n.id === 'string'));
			}
		} catch {
			// fall through to bundled file
		}
	}

	const res = await fetch(`${SITE_URL}/notices.json`, { cache: 'no-store' });
	if (!res.ok) return null;
	const file = (await res.json()) as { notices?: TrailNotice[] };
	return filterActiveNotices((file.notices ?? []).filter((n) => typeof n.id === 'string'));
}

export default async function handler(): Promise<Response> {
	if (!configureVapid()) return new Response('push not configured', { status: 200 });

	const entries = await fetchNotices();
	if (entries === null) return new Response('notices fetch failed', { status: 200 });
	const currentIds = entries.map((e) => e.id);

	const stateStore = getStore('push-state');
	const seen = (await stateStore.get('seen-notice-ids', { type: 'json' })) as string[] | null;

	// First run: baseline only when the feed has entries; empty feed waits for data.
	if (seen === null) {
		if (currentIds.length === 0) return new Response('waiting for notices', { status: 200 });
		await stateStore.setJSON('seen-notice-ids', currentIds);
		return new Response('baseline recorded', { status: 200 });
	}

	const seenSet = new Set(seen);
	const fresh = entries.filter((e) => !seenSet.has(e.id));
	if (fresh.length === 0) return new Response('no new entries', { status: 200 });

	const title =
		fresh.length === 1
			? resolveLocalized(fresh[0].title) || 'New trail condition notice'
			: `${fresh.length} new trail condition notices`;
	const payload = JSON.stringify({
		title: `CLDT Map: ${title}`,
		body: fresh
			.slice(0, 3)
			.map((e) => `[${e.severity ?? 'info'}] ${resolveLocalized(e.title) || e.id}`)
			.join('\n'),
		url: `${SITE_URL}/`,
	});

	const { sent, total } = await sendToAllSubscribers(payload);
	if (total === 0) return new Response('no subscribers', { status: 200 });

	await stateStore.setJSON('seen-notice-ids', [...new Set([...seen, ...fresh.map((e) => e.id)])]);
	return new Response(`sent ${sent}/${total} for ${fresh.length} new entries`, { status: 200 });
}

export const config: Config = {
	schedule: '@hourly',
};
