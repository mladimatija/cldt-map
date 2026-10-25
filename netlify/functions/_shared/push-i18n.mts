/**
 * Push notification strings, read from the app's message files. Named imports
 * of the top-level namespaces let the bundler keep only these parts.
 */
import { push as enPush, seasonalStatus as enSeasonal } from '../../../messages/en.json';
import { push as hrPush, seasonalStatus as hrSeasonal } from '../../../messages/hr.json';
import { push as dePush, seasonalStatus as deSeasonal } from '../../../messages/de.json';
import { push as itPush, seasonalStatus as itSeasonal } from '../../../messages/it.json';

export interface PushStrings {
	appName: string;
	newNotice: string;
	newNotices: string;
	newWarning: string;
	newWarnings: string;
	/** Seasonal-status severity labels by severity code. */
	severity: Record<string, string>;
}

const STRINGS: Record<string, PushStrings> = {
	en: { ...enPush, severity: enSeasonal.severity },
	hr: { ...hrPush, severity: hrSeasonal.severity },
	de: { ...dePush, severity: deSeasonal.severity },
	it: { ...itPush, severity: itSeasonal.severity },
};

/** Strings for a subscriber's locale, English for anything unknown. */
export function pushStrings(locale: string): PushStrings {
	return STRINGS[locale] ?? STRINGS.en;
}

export const PUSH_LOCALES = new Set(Object.keys(STRINGS));

/** Fill a "{count}" placeholder (the messages avoid plural forms for push). */
export function withCount(template: string, count: number): string {
	return template.replace('{count}', String(count));
}
