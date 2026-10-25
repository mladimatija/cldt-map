/**
 * Scheduled check (hourly) for new trail condition notices; sends a web push
 * notification for entries not seen on the previous run (shared flow and state
 * rules in _shared/new-entries-push.mts). On a first run with an empty feed no
 * baseline is recorded, so the notices that appear later are not all "new".
 */

import type { Config } from '@netlify/functions';
import { isHttpsUrl, normalizeNoticeList } from '../../src/lib/feed-validation';
import type { LocalizedString, TrailNotice } from '../../src/lib/notices';
import { runNewEntriesPush } from './_shared/new-entries-push.mts';
import { pushStrings, withCount } from './_shared/push-i18n.mts';

const SITE_URL = process.env.URL ?? 'https://map.cldt.hr';

function resolveLocalized(value: LocalizedString, locale: string): string {
	if (typeof value === 'string') return value;
	return value[locale] ?? value.default;
}

function filterActiveNotices(notices: TrailNotice[], now = new Date()): TrailNotice[] {
	return notices.filter((n) => !n.expiresAt || new Date(n.expiresAt) > now);
}

/** The sources and notice validation of the app (src/lib/notices.ts): an https
 *  remote override, then the bundled file; malformed notices are dropped, so a
 *  push never announces a notice the app does not show. */
async function fetchNotices(): Promise<TrailNotice[] | null> {
	const remoteUrl = process.env.NEXT_PUBLIC_NOTICES_URL;
	const bundled = `${SITE_URL}/notices.json`;
	for (const url of isHttpsUrl(remoteUrl) ? [remoteUrl, bundled] : [bundled]) {
		try {
			const res = await fetch(url, { cache: 'no-store' });
			if (!res.ok) continue;
			const notices = normalizeNoticeList(await res.json());
			if (notices) return filterActiveNotices(notices);
		} catch {
			// try the next source
		}
	}
	return null;
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
