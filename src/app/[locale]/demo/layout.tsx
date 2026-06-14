/** Demo route metadata (production-public). */
import { generatePageMetadata, siteMetadata } from '@/lib/metadata';

export const metadata = generatePageMetadata({
	title: `Demo hike | ${siteMetadata.title}`,
	description: `Try a simulated hike on the ${siteMetadata.title} - sample waypoints, journal, and progress at ~4 km/h with no GPS needed.`,
	path: '/demo',
});

export default function DemoLayout({ children }: { children: React.ReactNode }): React.ReactNode {
	return children;
}
