/** Locale routing for next-intl: en/hr/de/it, no URL prefix (locale in middleware/cookie). */
import { defineRouting } from 'next-intl/routing';

const LOCALES = ['en', 'hr', 'de', 'it'] as const;
/** Union of all supported locale codes. Derived from LOCALES so adding a locale here propagates everywhere. */
export type Locale = (typeof LOCALES)[number];

const env = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;
const defaultLocale: Locale = LOCALES.includes(env as Locale) ? (env as Locale) : 'en';

export const routing = defineRouting({
	locales: LOCALES,
	defaultLocale,
	localePrefix: 'never',
	localeDetection: true,
	localeCookie: false, // Locale stored in localStorage with other user preferences
});
