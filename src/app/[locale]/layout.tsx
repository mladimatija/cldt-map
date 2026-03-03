/** Loads messages for the segment locale and wraps children in ClientIntlProvider and ServiceWorkerProvider. */
import { setRequestLocale } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { ClientIntlProvider } from '@/components/providers/ClientIntlProvider';
import { ServiceWorkerProvider } from '@/components/common/ServiceWorkerProvider';

type Props = {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
};

export function generateStaticParams(): Array<{ locale: string }> {
	return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: Props): Promise<React.ReactElement> {
	const { locale } = await params;
	if (!hasLocale(routing.locales, locale)) {
		notFound();
	}
	setRequestLocale(locale);

	const [enMessages, hrMessages] = await Promise.all([
		import('../../../messages/en.json').then((m) => m.default),
		import('../../../messages/hr.json').then((m) => m.default),
	]);

	const allMessages = { en: enMessages, hr: hrMessages };
	const initialMessages = allMessages[locale] ?? allMessages[routing.defaultLocale];

	return (
		<ClientIntlProvider allMessages={allMessages} initialLocale={locale} initialMessages={initialMessages}>
			<ServiceWorkerProvider>{children}</ServiceWorkerProvider>
		</ClientIntlProvider>
	);
}
