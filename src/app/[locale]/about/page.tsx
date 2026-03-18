'use client';

/** About page: project description, CLDT association, data sources, and links. */
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { siteMetadata } from '@/lib/metadata';
import { ExternalLink } from '@/components/ui/ExternalLink';

export default function AboutPage(): React.ReactNode {
	const t = useTranslations('about');
	const tCommon = useTranslations('common');
	const { companyName, companyUrl, githubUrl, authorName, authorUrl } = siteMetadata;

	return (
		<div className="container mx-auto px-4 py-8">
			<section aria-labelledby="about-heading" className="mx-auto max-w-3xl">
				<h1 className="text-cldt-blue mb-6 text-3xl font-bold" id="about-heading">
					{t('title')}
				</h1>

				<article className="mb-8">
					<h2 className="text-cldt-blue mb-3 text-2xl font-semibold">{t('whatIsThis')}</h2>
					<p className="mb-4">{t('whatIsThisDesc', { title: siteMetadata.title })}</p>
				</article>

				<article className="mb-8">
					<h2 className="text-cldt-blue mb-3 text-2xl font-semibold">{t('aboutCldt', { companyName })}</h2>
					<p className="mb-4">
						{t.rich('aboutCldtDesc', {
							associationLink: t('associationLink'),
							link: (chunks) => <ExternalLink href={companyUrl}>{chunks}</ExternalLink>,
						})}
					</p>
				</article>

				<article className="mb-8">
					<h2 className="text-cldt-blue mb-3 text-2xl font-semibold">{t('mapFeatures')}</h2>
					<ul className="marker:text-cldt-green mb-4 list-disc pl-6">
						<li className="mb-2">{t('mapFeaturesList.trail')}</li>
						<li className="mb-2">{t('mapFeaturesList.elevation')}</li>
						<li className="mb-2">{t('mapFeaturesList.ruler')}</li>
						<li className="mb-2">{t('mapFeaturesList.gpxExport')}</li>
						<li className="mb-2">{t('mapFeaturesList.layers')}</li>
						<li className="mb-2">{t('mapFeaturesList.location')}</li>
						<li className="mb-2">{t('mapFeaturesList.share')}</li>
						<li className="mb-2">{t('mapFeaturesList.units')}</li>
						<li className="mb-2">{t('mapFeaturesList.darkMode')}</li>
						<li className="mb-2">{t('mapFeaturesList.offlineMaps')}</li>
						<li className="mb-2">{t('mapFeaturesList.weather')}</li>
						<li className="mb-2">{t('mapFeaturesList.trailNotices')}</li>
						<li className="mb-2">{t('mapFeaturesList.radar')}</li>
					</ul>
				</article>

				<article className="mb-8">
					<h2 className="text-cldt-blue mb-3 text-2xl font-semibold">{t('dataAttribution')}</h2>
					<p className="mb-4">{t('dataAttributionDesc', { companyName })}</p>
				</article>

				<article className="mb-8">
					<h2 className="text-cldt-blue mb-3 text-2xl font-semibold">{t('privacy')}</h2>
					<p className="mb-4">{t('privacyDesc')}</p>
				</article>

				<article className="mb-8">
					<h2 className="text-cldt-blue mb-3 text-2xl font-semibold">{t('links')}</h2>
					<ul className="mb-4 space-y-2">
						<li>
							<ExternalLink href={companyUrl}>{t('officialWebsite', { companyName })}</ExternalLink>
						</li>
						<li>
							<ExternalLink aria-label={t('githubAriaLabel', { title: siteMetadata.title })} href={githubUrl}>
								{t('sourceCode')}
							</ExternalLink>
						</li>
					</ul>
				</article>

				<article className="mb-8">
					<h2 className="text-cldt-blue mb-3 text-2xl font-semibold">{t('createdBy')}</h2>
					<p className="mb-4">
						<ExternalLink aria-label={t('visitAuthor', { authorName })} href={authorUrl}>
							{authorName}
						</ExternalLink>
					</p>
				</article>

				<Link
					className="bg-cldt-blue hover:bg-cldt-green focus-visible:bg-cldt-green inline-block rounded px-4 py-2 font-medium text-white transition-colors duration-200 outline-none hover:text-white hover:no-underline focus-visible:text-white focus-visible:no-underline"
					href="/"
				>
					{tCommon('returnToMap')}
				</Link>
			</section>
		</div>
	);
}
