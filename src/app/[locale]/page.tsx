/** Home: full-screen map inside Layout; sr-only title for accessibility. */
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Layout } from '@/components/layout/Layout';
import MapWrapper from '@/components/map/MapWrapper';
import { siteMetadata } from '@/lib/metadata';

type Props = {
	params: Promise<{ locale: string }>;
};

export default async function HomePage({ params }: Props): Promise<React.ReactElement> {
	const { locale } = await params;
	setRequestLocale(locale);
	const t = await getTranslations('home');

	return (
		<Layout>
			<h1 className="sr-only">{t('srTitle', { companyName: siteMetadata.companyName })}</h1>
			<MapWrapper locale={locale} />
		</Layout>
	);
}
