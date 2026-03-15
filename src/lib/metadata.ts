import type { Metadata } from 'next';

/**
 * Site metadata configuration
 * Used for SEO, social sharing, and site-wide defaults
 */
export const siteMetadata = {
	title: 'CLDT Map',
	titleTemplate: '%s',
	description: 'Interactive map of the Croatian Long Distance Trail (CLDT)',
	url: 'https://map.cldt.hr',
	authorName: 'Matija Culjak',
	authorUrl: 'https://matijaculjak.com',
	companyName: 'Croatian Long Distance Trail',
	companyShortName: 'CLDT',
	companyUrl: 'https://cldt.hr',
	githubUrl: 'https://github.com/mladimatija/cldt-map',
	twitterUsername: '',
	ogImage: '/cldt-logo.svg',
	locale: 'en_US',
	themeColor: '#1a6986',
};

/**
 * Generate page metadata for consistent SEO and Open Graph.
 * Use for route-specific layouts (e.g., /about).
 */
export function generatePageMetadata(options: { title: string; description: string; path?: string }): Metadata {
	const { title, description, path } = options;
	const url = path ? `${siteMetadata.url}${path}` : siteMetadata.url;
	return {
		title,
		description,
		openGraph: {
			title,
			description,
			url,
			siteName: siteMetadata.title,
			images: [
				{
					url: siteMetadata.ogImage,
					width: 1200,
					height: 630,
				},
			],
			locale: siteMetadata.locale,
			type: 'website',
		},
		twitter: {
			card: 'summary_large_image',
			title,
			description,
			creator: siteMetadata.twitterUsername,
		},
	};
}
