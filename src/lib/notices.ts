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

interface NoticesFile {
	notices?: TrailNotice[];
}

/** Returns only notices whose `expiresAt` is absent or still in the future. */
export function filterActiveNotices(notices: TrailNotice[], now: Date = new Date()): TrailNotice[] {
	return notices.filter((n) => !n.expiresAt || new Date(n.expiresAt) > now);
}

/** Module-level promise cache — ensures the fetch runs at most once per page load. */
let cachedPromise: Promise<TrailNotice[]> | null = null;

async function fetchNotices(): Promise<TrailNotice[]> {
	const remoteUrl = process.env.NEXT_PUBLIC_NOTICES_URL;
	if (remoteUrl) {
		try {
			const res = await fetch(remoteUrl);
			if (res.ok) {
				const json = (await res.json()) as NoticesFile;
				return filterActiveNotices(json.notices ?? []);
			}
		} catch {
			// fall through to local file
		}
	}

	try {
		const res = await fetch('/notices.json');
		if (res.ok) {
			const json = (await res.json()) as NoticesFile;
			return filterActiveNotices(json.notices ?? []);
		}
	} catch {
		// ignore
	}

	return [];
}

/**
 * Loads trail condition notices, trying the remote URL first (if configured via
 * NEXT_PUBLIC_NOTICES_URL) and falling back to the bundled /notices.json.
 * The result is cached for the lifetime of the page.
 */
export function loadNotices(): Promise<TrailNotice[]> {
	if (!cachedPromise) {
		cachedPromise = fetchNotices();
	}
	return cachedPromise;
}
