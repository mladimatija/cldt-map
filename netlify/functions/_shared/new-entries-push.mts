/**
 * Shared flow of the scheduled "new entries" push checks (trail notices and
 * seasonal status): fetch the current entries, compare them with the ids
 * already seen, push the fresh ones in each subscriber's language, and record
 * the ids.
 *
 * State is one blob per check in the "push-state" store. The first run only
 * records a baseline, so a redeploy never notifies the whole dataset. Every
 * later run records the ids whether or not anyone is subscribed, so a first
 * subscriber never receives a backlog.
 */
import { getStore } from '@netlify/blobs';
import { configureVapid, sendToAllSubscribers } from './push-send.mts';

const SITE_URL = process.env.URL ?? 'https://map.cldt.hr';

/** Most ids the seen list keeps. Ids that leave the feed stay in it, so an
 *  entry that drops out for a while (a failed remote feed falling back to the
 *  bundled file, a reverted edit) does not notify again when it returns; once
 *  the list is full, the ids that left the feed longest ago go first. */
const MAX_SEEN_IDS = 500;

/** The current ids last, after the ones that left the feed (oldest first). */
function nextSeenIds(seen: string[], currentIds: string[]): string[] {
	const current = new Set(currentIds);
	const left = seen.filter((id) => !current.has(id));
	const room = Math.max(0, MAX_SEEN_IDS - current.size);
	return [...left.slice(Math.max(0, left.length - room)), ...current];
}

export interface NewEntriesPushOptions<T extends { id: string }> {
	/** Blob key in the "push-state" store holding the ids already seen. */
	stateKey: string;
	/** Current entries, or null when the feed could not be read (state is left alone). */
	fetchEntries: () => Promise<T[] | null>;
	/** Title and body for the fresh entries in one locale. */
	buildMessage: (fresh: T[], locale: string) => { title: string; body: string };
	/** On a first run with an empty feed, wait for entries instead of recording
	 *  an empty baseline that would make the whole first batch "new". */
	waitForFirstEntries?: boolean;
}

export async function runNewEntriesPush<T extends { id: string }>(
	options: NewEntriesPushOptions<T>,
): Promise<Response> {
	if (!configureVapid()) return new Response('push not configured', { status: 200 });

	const entries = await options.fetchEntries();
	if (entries === null) return new Response('fetch failed', { status: 200 });
	const currentIds = entries.map((e) => e.id);

	const stateStore = getStore('push-state');
	const seen = (await stateStore.get(options.stateKey, { type: 'json' })) as string[] | null;

	if (seen === null) {
		if (options.waitForFirstEntries && currentIds.length === 0) {
			return new Response('waiting for entries', { status: 200 });
		}
		await stateStore.setJSON(options.stateKey, currentIds);
		return new Response('baseline recorded', { status: 200 });
	}

	const seenSet = new Set(seen);
	const fresh = entries.filter((e) => !seenSet.has(e.id));
	const next = nextSeenIds(seen, currentIds);
	if (fresh.length === 0) {
		// Still record when the list changed (an id left the feed), so the ids
		// that left longest ago are the first the cap drops.
		if (next.length !== seen.length || next.some((id, i) => id !== seen[i])) {
			await stateStore.setJSON(options.stateKey, next);
		}
		return new Response('no new entries', { status: 200 });
	}

	const { sent, total } = await sendToAllSubscribers((locale) => ({
		...options.buildMessage(fresh, locale),
		url: `${SITE_URL}/`,
	}));
	// Recorded after sending, so a run that fails mid-send retries next hour
	// (a duplicate is better than a lost warning).
	await stateStore.setJSON(options.stateKey, next);
	return new Response(total === 0 ? 'no subscribers' : `sent ${sent}/${total} for ${fresh.length} new entries`, {
		status: 200,
	});
}
