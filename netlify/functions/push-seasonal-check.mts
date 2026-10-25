/**
 * Scheduled check (hourly) for new seasonal-status entries; sends a web push
 * notification for entries not seen on the previous run (shared flow and state
 * rules in _shared/new-entries-push.mts). Notes are Croatian for Croatian
 * subscribers and English for everyone else, as the dataset carries both.
 */

import type { Config } from '@netlify/functions';
import { runNewEntriesPush } from './_shared/new-entries-push.mts';
import { pushStrings, withCount } from './_shared/push-i18n.mts';

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
