/** Loads messages for the segment locale and wraps children in ClientIntlProvider and ServiceWorkerProvider. */
import { getTimeZone, setRequestLocale } from 'next-intl/server';
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

	const [enMessages, hrMessages, deMessages, itMessages] = await Promise.all([
		import('../../../messages/en.json').then((m) => m.default),
		import('../../../messages/hr.json').then((m) => m.default),
		import('../../../messages/de.json').then((m) => m.default),
		import('../../../messages/it.json').then((m) => m.default),
	]);

	const allMessages = { en: enMessages, hr: hrMessages, de: deMessages, it: itMessages };
	const initialMessages = allMessages[locale] ?? allMessages[routing.defaultLocale];
	const timeZone = await getTimeZone();

	return (
		<ClientIntlProvider
			allMessages={allMessages}
			initialLocale={locale}
			initialMessages={initialMessages}
			timeZone={timeZone}
		>
			<ServiceWorkerProvider>{children}</ServiceWorkerProvider>
		</ClientIntlProvider>
	);
}
