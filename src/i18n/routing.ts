/** Locale routing for next-intl: en/hr/de/it, no URL prefix (locale from the cookie, else Accept-Language). */
import { defineRouting } from 'next-intl/routing';

export const LOCALES = ['en', 'hr', 'de', 'it'] as const;
/** Union of all supported locale codes. Derived from LOCALES, so adding a locale here propagates everywhere. */
export type Locale = (typeof LOCALES)[number];

const env = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;
const defaultLocale: Locale = LOCALES.includes(env as Locale) ? (env as Locale) : 'en';

/** The chosen language, which the middleware reads so the server renders it.
 *  It lasts a year, like the preferences kept in local storage. */
export const LOCALE_COOKIE = { name: 'NEXT_LOCALE', maxAge: 60 * 60 * 24 * 365 } as const;

export const routing = defineRouting({
	locales: LOCALES,
	defaultLocale,
	localePrefix: 'never',
	localeDetection: true,
	localeCookie: LOCALE_COOKIE,
});
