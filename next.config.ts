import fs from 'node:fs';
import path from 'node:path';
import { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// When running in a git worktree (`.git` is a file pointing to the main repo),
// inherit untracked env files (`.env.local`, `.env`) from the main worktree so
// `npm run dev` works without re-copying secrets into every worktree.
function loadEnvFromMainWorktree(): void {
	const cwd = process.cwd();
	const gitEntry = path.join(cwd, '.git');
	if (!fs.existsSync(gitEntry) || fs.statSync(gitEntry).isDirectory()) return;
	const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitEntry, 'utf8'));
	if (!match) return;
	const gitdir = path.resolve(cwd, match[1].trim());
	const mainWorktree = path.dirname(path.dirname(path.dirname(gitdir)));
	for (const name of ['.env.local', '.env']) {
		if (fs.existsSync(path.join(cwd, name))) continue;
		const src = path.join(mainWorktree, name);
		if (!fs.existsSync(src)) continue;
		for (const rawLine of fs.readFileSync(src, 'utf8').split('\n')) {
			const line = rawLine.trim();
			if (!line || line.startsWith('#')) continue;
			const eq = line.indexOf('=');
			if (eq === -1) continue;
			const key = line.slice(0, eq).trim();
			let value = line.slice(eq + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			if (!(key in process.env)) process.env[key] = value;
		}
	}
}
loadEnvFromMainWorktree();

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
	reactStrictMode: true,
	// cacheComponents: true causes "Map container is being reused by another instance" with react-leaflet
	// when navigating between pages; Leaflet needs a fresh container on each mount.
	images: {
		remotePatterns: [
			{ protocol: 'https', hostname: 'cldt.hr', pathname: '/**' },
			{ protocol: 'https', hostname: 'www.cldt.hr', pathname: '/**' },
		],
	},
	compress: true,
	poweredByHeader: false,
	async headers() {
		const baselineHeaders = [
			{ key: 'X-Content-Type-Options', value: 'nosniff' },
			{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
			{ key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
		];
		return [
			{
				source: '/:path*',
				headers: baselineHeaders,
			},
			{
				source: '/sw.js',
				headers: [
					{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
					{ key: 'Service-Worker-Allowed', value: '/' },
				],
			},
			{
				source: '/manifest.webmanifest',
				headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
			},
		];
	},
};

export default withNextIntl(nextConfig);
