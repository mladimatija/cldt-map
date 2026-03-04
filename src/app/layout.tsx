/**
 * Root layout: fonts, global metadata, ThemeProvider. ServiceWorker lives in [locale] layout (inside ClientIntlProvider for i18n). Locale from next-intl middleware (x-next-intl-locale).
 */
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Geist, Geist_Mono } from 'next/font/google';
import React, { Suspense } from 'react';
import './globals.css';
import { getDefaultMapTileUrl } from '@/lib/config';
import { siteMetadata } from '@/lib/metadata';
import ThemeProvider from '@/components/common/ThemeProvider';

const geistSans = Geist({
	variable: '--font-geist-sans',
	subsets: ['latin'],
});

const geistMono = Geist_Mono({
	variable: '--font-geist-mono',
	subsets: ['latin'],
});

export const viewport: Viewport = {
	themeColor: siteMetadata.themeColor,
};

export const metadata: Metadata = {
	title: siteMetadata.title,
	description: siteMetadata.description,
	metadataBase: new URL(siteMetadata.url),
	manifest: '/manifest.webmanifest',
	icons: {
		icon: '/cldt-logo.svg',
		apple: '/cldt-logo.svg',
	},
	openGraph: {
		title: siteMetadata.title,
		description: siteMetadata.description,
		url: siteMetadata.url,
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
		title: siteMetadata.title,
		description: siteMetadata.description,
		creator: siteMetadata.twitterUsername,
	},
};

/** Preconnect to OSM tile servers so the first map tile loads faster. */
const TILE_ORIGINS = [
	'https://a.tile.openstreetmap.org',
	'https://b.tile.openstreetmap.org',
	'https://c.tile.openstreetmap.org',
] as const;

function HtmlShell({ lang, children }: { lang: string; children: React.ReactNode }): React.ReactElement {
	const lcpTileUrl = getDefaultMapTileUrl();
	return (
		<html className={`${geistSans.variable} ${geistMono.variable} h-full`} lang={lang}>
			<head>
				{TILE_ORIGINS.map((origin) => (
					<link crossOrigin="" href={origin} key={origin} rel="preconnect" />
				))}
				<link as="image" fetchPriority="high" href={lcpTileUrl} rel="preload" />
			</head>
			<body className="h-full bg-white font-sans text-base leading-relaxed antialiased">
				<ThemeProvider>{children}</ThemeProvider>
			</body>
		</html>
	);
}

async function LocaleHtml({ children }: { children: React.ReactNode }): Promise<React.ReactElement> {
	const headersList = await headers();
	const locale = headersList.get('x-next-intl-locale') ?? 'en';
	return <HtmlShell lang={locale}>{children}</HtmlShell>;
}

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>): React.ReactElement {
	return (
		<Suspense fallback={<HtmlShell lang="en">{children}</HtmlShell>}>
			<LocaleHtml>{children}</LocaleHtml>
		</Suspense>
	);
}
