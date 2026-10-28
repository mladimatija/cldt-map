'use client';

/**
 * Wraps the app in next-intl and provides locale state. A language choice is
 * kept in the locale cookie, so the server renders it, and in localStorage for
 * the pages that pick their language on the client (offline, global error).
 * useClientLocale() gives children access to the current locale and setLocale.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { LOCALE_COOKIE, routing, type Locale } from '@/i18n/routing';

const LOCALE_STORAGE_KEY = 'cldt-map-locale';

function getStoredLocale(): string | null {
	if (typeof window === 'undefined') return null;
	const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
	return stored && (routing.locales as readonly string[]).includes(stored) ? stored : null;
}

function setStoredLocale(locale: string): void {
	if (typeof document === 'undefined') return;
	localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

function hasLocaleCookie(): boolean {
	return document.cookie.split('; ').some((entry) => entry.startsWith(`${LOCALE_COOKIE.name}=`));
}

function writeLocaleCookie(locale: string): void {
	document.cookie = `${LOCALE_COOKIE.name}=${locale}; path=/; max-age=${LOCALE_COOKIE.maxAge}; samesite=lax`;
}

type Messages = Record<string, Record<string, unknown>>;

type ClientIntlContextValue = {
	locale: string;
	setLocale: (locale: Locale) => void;
};

const ClientIntlContext = createContext<ClientIntlContextValue | null>(null);

export function useClientLocale(): ClientIntlContextValue {
	const ctx = useContext(ClientIntlContext);
	if (!ctx) throw new Error('useClientLocale must be used within ClientIntlProvider');
	return ctx;
}

type Props = {
	initialLocale: string;
	initialMessages: Messages;
	timeZone?: string;
	children: React.ReactNode;
};

export function ClientIntlProvider({ initialLocale, initialMessages, timeZone, children }: Props): React.ReactElement {
	const safeInitial = (routing.locales as readonly string[]).includes(initialLocale)
		? initialLocale
		: routing.defaultLocale;
	const [locale, setLocaleState] = useState<string>(safeInitial);

	// Only the active locale ships with the page; the other locales'
	// messages (~50 KB raw each) load on demand as separate chunks when the
	// user actually switches language. The previous design embedded all
	// four locales in the flight payload of every page load.
	const [loadedMessages, setLoadedMessages] = useState<Record<string, Messages>>({
		[safeInitial]: initialMessages,
	});

	const activateLocale = useCallback(
		(targetLocale: string) => {
			if (!(routing.locales as readonly string[]).includes(targetLocale)) return;
			const cached = loadedMessages[targetLocale];
			const messagesFor = cached
				? Promise.resolve(cached)
				: import(`../../../messages/${targetLocale}.json`).then((mod) => mod.default as Messages);
			void messagesFor
				.then((targetMessages) => {
					setLoadedMessages((prev) => (prev[targetLocale] ? prev : { ...prev, [targetLocale]: targetMessages }));
					// Switch only after the messages exist so no frame renders
					// the new locale with the old locale's strings.
					setLocaleState(targetLocale);
				})
				.catch(() => {
					// Keep the current locale; the switcher stays usable.
				});
		},
		[loadedMessages],
	);

	// A choice saved before the locale cookie existed lives only in
	// localStorage: move it into the cookie (the server renders it from the
	// next load on) and apply it to this one.
	useEffect(() => {
		if (hasLocaleCookie()) return;
		const stored = getStoredLocale();
		if (!stored) return;
		writeLocaleCookie(stored);
		if (stored !== safeInitial) activateLocale(stored);
	}, [safeInitial, activateLocale]);

	// The new language applies in place: a navigation would change the [locale]
	// segment and remount the page, map included. Server-rendered text follows
	// on the next load, from the cookie.
	const setLocale = useCallback(
		(targetLocale: Locale) => {
			setStoredLocale(targetLocale);
			writeLocaleCookie(targetLocale);
			activateLocale(targetLocale);
		},
		[activateLocale],
	);

	// The server renders <html lang> once; keep it right after a switch in place,
	// so screen readers read the page in its language.
	useEffect(() => {
		document.documentElement.lang = locale;
	}, [locale]);

	const messages = loadedMessages[locale] ?? initialMessages;

	return (
		<ClientIntlContext.Provider value={{ locale, setLocale }}>
			<NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
				{children}
			</NextIntlClientProvider>
		</ClientIntlContext.Provider>
	);
}
