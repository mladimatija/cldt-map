'use client';

/**
 * Wraps the app in next-intl and provides locale state; syncs locale with localStorage so language choice persists.
 * useClientLocale() gives children access to the current locale and setLocale.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { routing } from '@/i18n/routing';

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
	setLocale: (locale: 'en' | 'hr') => void;
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
	allMessages: Record<string, Messages>;
	children: React.ReactNode;
};

export function ClientIntlProvider({
	initialLocale,
	initialMessages,
	allMessages,
	children,
}: Props): React.ReactElement {
	const [locale, setLocaleState] = useState<string>(() =>
		(routing.locales as readonly string[]).includes(initialLocale) ? initialLocale : routing.defaultLocale,
	);

	// Sync from localStorage on mount (server can't read localStorage, so we correct after hydrate)
	useEffect(() => {
		const stored = getStoredLocale();
		if (stored && stored !== initialLocale) {
			queueMicrotask(() => setLocaleState(stored));
		}
	}, [initialLocale]);

	const setLocale = useCallback((targetLocale: 'en' | 'hr') => {
		setLocaleState(targetLocale);
		setStoredLocale(targetLocale);
	}, []);

	const messages = allMessages[locale] ?? initialMessages;

	return (
		<ClientIntlContext.Provider value={{ locale, setLocale }}>
			<NextIntlClientProvider locale={locale} messages={messages}>
				{children}
			</NextIntlClientProvider>
		</ClientIntlContext.Provider>
	);
}
