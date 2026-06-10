import React from 'react';
import { notFound } from 'next/navigation';
import { TestClient } from './ui';

/** Server-side gate for the dev-only store playground. In production builds
 *  the route 404s before any client code ships, replacing the previous
 *  client-side redirect that still bundled and briefly rendered the page. */
export default function TestPage(): React.ReactElement {
	if (process.env.NODE_ENV === 'production') {
		notFound();
	}
	return <TestClient />;
}
