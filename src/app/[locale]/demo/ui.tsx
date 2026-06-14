'use client';

import React from 'react';
import MapWrapper from '@/components/map/MapWrapper';
import { DemoSessionController } from '@/components/demo/DemoSessionController';

interface DemoClientProps {
	locale: string;
}

/** Full-screen map with auto-started demo hike; stays on /demo (no redirect). */
export function DemoClient({ locale }: DemoClientProps): React.ReactElement {
	return (
		<>
			<DemoSessionController />
			<MapWrapper locale={locale} />
		</>
	);
}
