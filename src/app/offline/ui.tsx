'use client';

import React, { useMemo, useState } from 'react';
import en from '../../../messages/en.json';
import hr from '../../../messages/hr.json';
import { routing } from '@/i18n/routing';
import { Button, buttonVariants } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

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
