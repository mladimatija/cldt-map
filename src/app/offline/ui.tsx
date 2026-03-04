'use client';

import React, { useMemo, useState } from 'react';
import en from '../../../messages/en.json';
import hr from '../../../messages/hr.json';
import { routing } from '@/i18n/routing';

const LOCALE_STORAGE_KEY = 'cldt-map-locale';

const messages = {
	en: (en as { offline: { title: string; description: string; tryAgain: string; goHome: string } }).offline,
	hr: (hr as { offline: { title: string; description: string; tryAgain: string; goHome: string } }).offline,
};

function getOfflineLocale(): 'en' | 'hr' {
	if (typeof window === 'undefined') return routing.defaultLocale;
	const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
	return (routing.locales as readonly string[]).includes(stored ?? '')
		? (stored as 'en' | 'hr')
		: routing.defaultLocale;
}

export function OfflineClient(): React.ReactElement {
	const [locale] = useState<'en' | 'hr'>(getOfflineLocale);
	const t = useMemo(() => messages[locale] ?? messages.en, [locale]);

	return (
		<main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-14">
			<h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
			<p className="mt-3 text-sm text-black/70">{t.description}</p>
			<div className="mt-6 flex gap-3">
				<button
					className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
					type="button"
					onClick={() => window.location.reload()}
				>
					{t.tryAgain}
				</button>
				{/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
				<a className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium" href="/" rel="noreferrer">
					{t.goHome}
				</a>
			</div>
		</main>
	);
}
