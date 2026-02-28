/** About section: only sets metadata (title, description, path); layout is a passthrough. */
import { generatePageMetadata, siteMetadata } from '@/lib/metadata';

export const metadata = generatePageMetadata({
	title: `About | ${siteMetadata.title}`,
	description: `Learn about the ${siteMetadata.title} - ${siteMetadata.description}`,
	path: '/about',
});

export default function AboutLayout({ children }: { children: React.ReactNode }): React.ReactNode {
	return children;
}
