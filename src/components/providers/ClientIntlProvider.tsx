'use client';

/**
 * Wraps the app in next-intl and provides locale state; syncs locale with localStorage so language choice persists.
 * useClientLocale() gives children access to the current locale and setLocale.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { routing, type Locale } from '@/i18n/routing';

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
			if (loadedMessages[targetLocale]) {
				setLocaleState(targetLocale);
				return;
			}
			void import(`../../../messages/${targetLocale}.json`)
				.then((mod) => {
					setLoadedMessages((prev) => (prev[targetLocale] ? prev : { ...prev, [targetLocale]: mod.default }));
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

	// Sync from localStorage on mount (server can't read localStorage, so we correct after hydrate)
	useEffect(() => {
		const stored = getStoredLocale();
		if (stored && stored !== locale) {
			queueMicrotask(() => activateLocale(stored));
		}
	}, [locale, activateLocale]);

	const setLocale = useCallback(
		(targetLocale: Locale) => {
			setStoredLocale(targetLocale);
			activateLocale(targetLocale);
		},
		[activateLocale],
	);

	const messages = loadedMessages[locale] ?? initialMessages;

	return (
		<ClientIntlContext.Provider value={{ locale, setLocale }}>
			<NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
				{children}
			</NextIntlClientProvider>
		</ClientIntlContext.Provider>
	);
}
