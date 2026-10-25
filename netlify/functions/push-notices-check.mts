/**
 * Scheduled check (hourly) for new trail condition notices; sends a web push
 * notification for entries not seen on the previous run (shared flow and state
 * rules in _shared/new-entries-push.mts). On a first run with an empty feed no
 * baseline is recorded, so the notices that appear later are not all "new".
 */

import type { Config } from '@netlify/functions';
import { runNewEntriesPush } from './_shared/new-entries-push.mts';
import { pushStrings, withCount } from './_shared/push-i18n.mts';

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
	return runNewEntriesPush<TrailNotice>({
		stateKey: 'seen-notice-ids',
		fetchEntries: fetchNotices,
		waitForFirstEntries: true,
		buildMessage: (fresh, locale) => {
			const strings = pushStrings(locale);
			const title =
				fresh.length === 1
					? resolveLocalized(fresh[0].title, locale) || strings.newNotice
					: withCount(strings.newNotices, fresh.length);
			return {
				title: `${strings.appName}: ${title}`,
				body: fresh
					.slice(0, 3)
					.map((e) => resolveLocalized(e.title, locale) || e.id)
					.join('\n'),
			};
		},
	});
}

export const config: Config = {
	schedule: '@hourly',
};
