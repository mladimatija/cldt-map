import type { MetadataRoute } from 'next';
import { siteMetadata } from '@/lib/metadata';

/**
 * Web app manifest for PWA "Add to Home Screen" and app-like experience.
 * Served at /manifest.webmanifest. Next.js links it automatically.
 */
export default function manifest(): MetadataRoute.Manifest {
	return {
		name: siteMetadata.title,
		short_name: siteMetadata.companyShortName + ' Map',
		description: siteMetadata.description,
		start_url: '/',
		scope: '/',
		display: 'standalone',
		orientation: 'any',
		theme_color: siteMetadata.themeColor,
		background_color: '#ffffff',
		icons: [
			{
				src: '/cldt-logo.svg',
				sizes: 'any',
				type: 'image/svg+xml',
				purpose: 'any',
			},
			{
				src: '/icon-192.png',
				sizes: '192x192',
				type: 'image/png',
				purpose: 'any',
			},
			{
				src: '/icon-512.png',
				sizes: '512x512',
				type: 'image/png',
				purpose: 'any',
			},
			{
				src: '/icon-512.png',
				sizes: '512x512',
				type: 'image/png',
				purpose: 'maskable',
			},
		],
		categories: ['navigation', 'travel'],
		lang: 'en',
	};
}
