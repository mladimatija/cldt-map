import { createDatasetLoader } from '@/lib/dataset-loader';
import { normalizeNoticeList } from '@/lib/feed-validation';

export type NoticeSeverity = 'emergency' | 'closure' | 'warning' | 'info';

/** A string that is either a plain value or a locale map with a required `default` key. */
export type LocalizedString = string | ({ default: string } & Record<string, string>);

/** Resolves a LocalizedString to a plain string for the given locale. */
export function resolveLocalized(value: LocalizedString, locale: string): string {
	if (typeof value === 'string') return value;
	return value[locale] ?? value.default;
}

export interface TrailNotice {
	id: string;
	severity: NoticeSeverity;
	title: LocalizedString;
	message: LocalizedString;
	startsAt?: string;
	expiresAt?: string;
	distanceStartKm?: number;
	distanceEndKm?: number;
	url?: string;
	dismissible: boolean;
}

/** Returns only notices whose `expiresAt` is absent or still in the future. */
function filterActiveNotices(notices: TrailNotice[], now: Date = new Date()): TrailNotice[] {
	return notices.filter((n) => !n.expiresAt || new Date(n.expiresAt) > now);
}

const noticesLoader = createDatasetLoader({
	remoteUrl: process.env.NEXT_PUBLIC_NOTICES_URL,
	localPath: '/notices.json',
	normalize: (raw) => {
		const notices = normalizeNoticeList(raw);
		return notices && filterActiveNotices(notices);
	},
});

/**
 * Loads trail condition notices, trying the remote URL first (if configured via
 * NEXT_PUBLIC_NOTICES_URL, https only) and falling back to the bundled
 * /notices.json. The result is cached for the lifetime of the page.
 */
export async function loadNotices(): Promise<TrailNotice[]> {
	return (await noticesLoader.load()) ?? [];
}
