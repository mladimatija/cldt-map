/**
 * Scheduled check (hourly) for new seasonal-status entries; sends a web push
 * notification for entries not seen on the previous run (shared flow and state
 * rules in _shared/new-entries-push.mts). Notes are Croatian for Croatian
 * subscribers and English for everyone else, as the dataset carries both.
 */

import type { Config } from '@netlify/functions';
import { isHttpsUrl, normalizeSeasonalStatusFile } from '../../src/lib/feed-validation';
import type { SeasonalStatusEntry as SeasonalEntry } from '../../src/lib/seasonal-status';
import { runNewEntriesPush } from './_shared/new-entries-push.mts';
import { pushStrings, withCount } from './_shared/push-i18n.mts';

const SITE_URL = process.env.URL ?? 'https://map.cldt.hr';

/** The sources and entry validation of the app (src/lib/seasonal-status.ts):
 *  an https remote override, then the bundled file; malformed entries are
 *  dropped, so a push never announces an entry the app does not show. */
async function fetchSeasonalEntries(): Promise<SeasonalEntry[] | null> {
	const remoteUrl = process.env.NEXT_PUBLIC_SEASONAL_STATUS_URL;
	const bundled = `${SITE_URL}/seasonal-status.json`;
	for (const url of isHttpsUrl(remoteUrl) ? [remoteUrl, bundled] : [bundled]) {
		try {
			const res = await fetch(url, { cache: 'no-store' });
			if (!res.ok) continue;
			const file = normalizeSeasonalStatusFile(await res.json());
			if (file) return file.entries;
		} catch {
			// try the next source
		}
	}
	return null;
}

function entryNote(entry: SeasonalEntry, locale: string): string | undefined {
	return locale === 'hr' ? (entry.note_hr ?? entry.note_en) : (entry.note_en ?? entry.note_hr);
}

export default async function handler(): Promise<Response> {
	return runNewEntriesPush<SeasonalEntry>({
		stateKey: 'seen-seasonal-ids',
		fetchEntries: fetchSeasonalEntries,
		buildMessage: (fresh, locale) => {
			const strings = pushStrings(locale);
			const title =
				fresh.length === 1
					? (entryNote(fresh[0], locale) ?? strings.newWarning)
					: withCount(strings.newWarnings, fresh.length);
			return {
				title: `${strings.appName}: ${title}`,
				body: fresh
					.slice(0, 3)
					.map((e) => {
						const severity = e.severity ? (strings.severity[e.severity] ?? e.severity) : '';
						const note = entryNote(e, locale) ?? e.id;
						return severity ? `${severity}: ${note}` : note;
					})
					.join('\n'),
			};
		},
	});
}

export const config: Config = {
	schedule: '@hourly',
};
