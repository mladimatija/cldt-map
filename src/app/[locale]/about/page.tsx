'use client';

/** About page: project description, CLDT association, data sources, and links. */
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { siteMetadata } from '@/lib/metadata';
import { ExternalLink, INLINE_LINK_CLASS } from '@/components/ui/ExternalLink';
import { BackToMapBar } from '@/components/layout/BackToMapBar';
import { CONTENT_PAGE_CONTAINER } from '@/components/layout/content-page';
import { Layout } from '@/components/layout/Layout';
import { cn } from '@/lib/utils';

export default function AboutPage(): React.ReactNode {
	const t = useTranslations('about');
	const { companyName, companyUrl, githubUrl, authorName, authorUrl } = siteMetadata;

	return (
		<Layout overlayHeader={false} showHeader={false}>
			<BackToMapBar containerClassName={CONTENT_PAGE_CONTAINER} />
			<div className={cn(CONTENT_PAGE_CONTAINER, 'py-8')}>
				<section aria-labelledby="about-heading">
					<h1 className="text-cldt-blue mb-6 text-3xl font-bold" id="about-heading">
						{t('title')}
					</h1>

					<article className="mb-8">
						<h2 className="text-cldt-blue mb-3 text-2xl font-semibold">{t('whatIsThis')}</h2>
						<p className="mb-4">{t('whatIsThisDesc', { title: siteMetadata.title })}</p>
						<aside
							aria-label={t('officialApp')}
							className="border-cldt-blue mb-4 rounded border-l-4 bg-gray-50 p-4 dark:bg-[var(--bg-secondary)]"
						>
							<h3 className="text-cldt-blue mb-2 text-base font-semibold">{t('officialApp')}</h3>
							<p className="m-0 text-sm">
								{t.rich('officialAppDesc', {
									title: siteMetadata.title,
									link: (chunks) => (
										<ExternalLink href="https://faroutguides.com/croatian-long-distance-trail-map/">
											{chunks}
										</ExternalLink>
									),
								})}
							</p>
						</aside>
						<aside
							aria-label={t('demoCalloutTitle')}
							className="border-cldt-green mb-4 rounded border-l-4 bg-gray-50 p-4 dark:bg-[var(--bg-secondary)]"
						>
							<h3 className="text-cldt-green mb-2 text-base font-semibold">{t('demoCalloutTitle')}</h3>
							<p className="m-0 text-sm">
								{t('demoCalloutDesc')}{' '}
								<Link className={INLINE_LINK_CLASS} href="/demo">
									{t('demoCalloutLink')}
								</Link>
							</p>
						</aside>
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
							<li className="mb-2">{t('mapFeaturesList.distanceEtaOverlay')}</li>
							<li className="mb-2">{t('mapFeaturesList.gpxExport')}</li>
							<li className="mb-2">{t('mapFeaturesList.printExport')}</li>
							<li className="mb-2">{t('mapFeaturesList.layers')}</li>
							<li className="mb-2">{t('mapFeaturesList.terrainOverlays')}</li>
							<li className="mb-2">{t('mapFeaturesList.location')}</li>
							<li className="mb-2">{t('mapFeaturesList.navTargetHud')}</li>
							<li className="mb-2">{t('mapFeaturesList.share')}</li>
							<li className="mb-2">{t('mapFeaturesList.units')}</li>
							<li className="mb-2">{t('mapFeaturesList.darkMode')}</li>
							<li className="mb-2">{t('mapFeaturesList.offlineMaps')}</li>
							<li className="mb-2">{t('mapFeaturesList.offlineReadiness')}</li>
							<li className="mb-2">{t('mapFeaturesList.weather')}</li>
							<li className="mb-2">{t('mapFeaturesList.trailNotices')}</li>
							<li className="mb-2">{t('mapFeaturesList.seasonalStatus')}</li>
							<li className="mb-2">{t('mapFeaturesList.mineAreas')}</li>
							<li className="mb-2">{t('mapFeaturesList.severeWeather')}</li>
							<li className="mb-2">{t('mapFeaturesList.radar')}</li>
							<li className="mb-2">{t('mapFeaturesList.sunsetPosition')}</li>
							<li className="mb-2">{t('mapFeaturesList.daylightBudget')}</li>
							<li className="mb-2">{t('mapFeaturesList.stagePlanner')}</li>
							<li className="mb-2">{t('mapFeaturesList.gpxImport')}</li>
							<li className="mb-2">{t('mapFeaturesList.emergency')}</li>
							<li className="mb-2">{t('mapFeaturesList.firstAid')}</li>
							<li className="mb-2">{t('mapFeaturesList.trailStyle')}</li>
							<li className="mb-2">{t('mapFeaturesList.surfaceAndSac')}</li>
							<li className="mb-2">{t('mapFeaturesList.distanceMarkers')}</li>
							<li className="mb-2">{t('mapFeaturesList.pois')}</li>
							<li className="mb-2">{t('mapFeaturesList.tripBrief')}</li>
							<li className="mb-2">{t('mapFeaturesList.offRouteAlert')}</li>
							<li className="mb-2">{t('mapFeaturesList.waterIntelligence')}</li>
							<li className="mb-2">{t('mapFeaturesList.completionTracking')}</li>
							<li className="mb-2">{t('mapFeaturesList.upNext')}</li>
							<li className="mb-2">{t('mapFeaturesList.packWeight')}</li>
							<li className="mb-2">{t('mapFeaturesList.waypointsJournal')}</li>
							<li className="mb-2">{t('mapFeaturesList.resupply')}</li>
							<li className="mb-2">{t('mapFeaturesList.pushAlerts')}</li>
							<li className="mb-2">{t('mapFeaturesList.welcomeCard')}</li>
							<li className="mb-2">{t('mapFeaturesList.guidedTour')}</li>
							<li className="mb-2">{t('mapFeaturesList.helpPanel')}</li>
							<li className="mb-2">{t('mapFeaturesList.accessibility')}</li>
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
				</section>
			</div>
		</Layout>
	);
}
