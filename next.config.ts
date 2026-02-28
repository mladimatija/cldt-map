import { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	// cacheComponents: true causes "Map container is being reused by another instance" with react-leaflet
	// when navigating between pages; Leaflet needs a fresh container on each mount.
	images: {
		remotePatterns: [
			{
				protocol: 'https',
				hostname: '**',
			},
			{
				protocol: 'https',
				hostname: 'cldt.hr',
				pathname: '/**',
			},
		],
	},
	compress: true,
	poweredByHeader: false,
};

export default withNextIntl(nextConfig);
