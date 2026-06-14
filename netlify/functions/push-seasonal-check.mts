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
import { configureVapid, sendToAllSubscribers } from './_shared/push-send.mts';

const SITE_URL = process.env.URL ?? 'https://map.cldt.hr';

interface SeasonalEntry {
	id: string;
	severity?: string;
	note_en?: string;
	note_hr?: string;
}

async function fetchSeasonalEntries(): Promise<SeasonalEntry[] | null> {
	const remoteUrl = process.env.NEXT_PUBLIC_SEASONAL_STATUS_URL;
	if (remoteUrl) {
		try {
			const res = await fetch(remoteUrl, { cache: 'no-store' });
			if (res.ok) {
				const file = (await res.json()) as { entries?: SeasonalEntry[] };
				return (file.entries ?? []).filter((e) => typeof e.id === 'string');
			}
		} catch {
			// fall through to bundled file
		}
	}

	const res = await fetch(`${SITE_URL}/seasonal-status.json`, { cache: 'no-store' });
	if (!res.ok) return null;
	const file = (await res.json()) as { entries?: SeasonalEntry[] };
	return (file.entries ?? []).filter((e) => typeof e.id === 'string');
}

export default async function handler(): Promise<Response> {
	if (!configureVapid()) return new Response('push not configured', { status: 200 });

	const entries = await fetchSeasonalEntries();
	if (entries === null) return new Response('seasonal fetch failed', { status: 200 });
	const currentIds = entries.map((e) => e.id);

	const stateStore = getStore('push-state');
	const seen = (await stateStore.get('seen-seasonal-ids', { type: 'json' })) as string[] | null;

	// First run: baseline only, never blast the whole dataset.
	if (seen === null) {
		await stateStore.setJSON('seen-seasonal-ids', currentIds);
		return new Response('baseline recorded', { status: 200 });
	}

	const seenSet = new Set(seen);
	const fresh = entries.filter((e) => !seenSet.has(e.id));
	if (fresh.length === 0) return new Response('no new entries', { status: 200 });

	const title =
		fresh.length === 1
			? (fresh[0].note_en ?? fresh[0].note_hr ?? 'New trail warning')
			: `${fresh.length} new trail warnings`;
	const payload = JSON.stringify({
		title: `CLDT Map: ${title}`,
		body: fresh
			.slice(0, 3)
			.map((e) => `[${e.severity ?? 'info'}] ${e.note_en ?? e.note_hr ?? e.id}`)
			.join('\n'),
		url: `${SITE_URL}/`,
	});

	const { sent, total } = await sendToAllSubscribers(payload);
	if (total === 0) return new Response('no subscribers', { status: 200 });

	await stateStore.setJSON('seen-seasonal-ids', [...new Set([...seen, ...fresh.map((e) => e.id)])]);
	return new Response(`sent ${sent}/${total} for ${fresh.length} new entries`, { status: 200 });
}

export const config: Config = {
	schedule: '@hourly',
};
