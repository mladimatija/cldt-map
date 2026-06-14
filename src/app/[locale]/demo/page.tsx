/** Demo hike: full map with simulated mid-trail GPS and sample progress data. */
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Layout } from '@/components/layout/Layout';
import { siteMetadata } from '@/lib/metadata';
import { DemoClient } from './ui';

type Props = {
	params: Promise<{ locale: string }>;
};

export default async function DemoPage({ params }: Props): Promise<React.ReactElement> {
	const { locale } = await params;
	setRequestLocale(locale);
	const t = await getTranslations('demo');

	return (
		<Layout>
			<h1 className="sr-only">{t('srTitle', { title: siteMetadata.title })}</h1>
			<DemoClient locale={locale} />
		</Layout>
	);
}
