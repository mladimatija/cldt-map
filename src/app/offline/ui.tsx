'use client';

import React, { useMemo, useState } from 'react';
import en from '../../../messages/en.json';
import hr from '../../../messages/hr.json';
import de from '../../../messages/de.json';
import it from '../../../messages/it.json';
import { routing, type Locale } from '@/i18n/routing';
import { Button, buttonVariants } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const LOCALE_STORAGE_KEY = 'cldt-map-locale';

type OfflineMessages = { offline: { title: string; description: string; tryAgain: string; goHome: string } };
const messages = {
	en: (en as OfflineMessages).offline,
	hr: (hr as OfflineMessages).offline,
	de: (de as OfflineMessages).offline,
	it: (it as OfflineMessages).offline,
};

function getOfflineLocale(): Locale {
	if (typeof window === 'undefined') return routing.defaultLocale;
	const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
	return (routing.locales as readonly string[]).includes(stored ?? '') ? (stored as Locale) : routing.defaultLocale;
}

export function OfflineClient(): React.ReactElement {
	const [locale] = useState<Locale>(getOfflineLocale);
	const t = useMemo(() => messages[locale] ?? messages.en, [locale]);

	return (
		<main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-14">
			<h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
			<p className="mt-3 text-sm text-black/70">{t.description}</p>
			<div className="mt-6 flex gap-3">
				<Button size="default" variant="offlinePrimary" onClick={() => window.location.reload()}>
					{t.tryAgain}
				</Button>
				{/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
				<a className={cn(buttonVariants({ variant: 'offlineOutline', size: 'default' }))} href="/" rel="noreferrer">
					{t.goHome}
				</a>
			</div>
		</main>
	);
}
