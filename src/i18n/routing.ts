/** Locale routing for next-intl: en/hr, no URL prefix (locale in middleware/cookie). */
import { defineRouting } from 'next-intl/routing';

const defaultLocale: 'en' | 'hr' = process.env.NEXT_PUBLIC_DEFAULT_LOCALE === 'hr' ? 'hr' : 'en';

export const routing = defineRouting({
	locales: ['en', 'hr'],
	defaultLocale,
	localePrefix: 'never',
	localeDetection: true,
	localeCookie: false, // Locale stored in localStorage with other user preferences
});
