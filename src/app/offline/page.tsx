import type { Metadata } from 'next';
import React from 'react';
import { OfflineClient } from './ui';

export const metadata: Metadata = {
	title: 'Offline',
	robots: { index: false, follow: false },
};

export default function OfflinePage(): React.ReactElement {
	return <OfflineClient />;
}
