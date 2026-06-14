'use client';

import React from 'react';
import { TestWalkSimulator } from '@/components/TestWalkSimulator';
import { TestBannerInjectors } from '@/components/TestBannerInjectors';
import { TestResetUtilities } from '@/components/TestResetUtilities';
import { TestDataSeeders } from '@/components/TestDataSeeders';
import { OffRouteAlertSimulator } from '@/components/OffRouteAlertSimulator';
import { Layout } from '@/components/layout/Layout';
import { BackToMapBar } from '@/components/layout/BackToMapBar';
import { CONTENT_PAGE_CONTAINER } from '@/components/layout/content-page';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

/** Dev-only store playground. Reached only in development: the server page
 *  wrapper 404s this route in production builds. */
export function TestClient(): React.ReactElement {
	const t = useTranslations('test');

	return (
		<Layout overlayHeader={false} showHeader={false}>
			<BackToMapBar />
			<div className={cn(CONTENT_PAGE_CONTAINER, 'py-8')}>
				<h1 className="mb-2">{t('title')}</h1>
				<p className="mb-6 text-gray-600">{t('description')}</p>

				<div className="space-y-6">
					<TestWalkSimulator />
					<TestBannerInjectors />
					<OffRouteAlertSimulator />
					<TestDataSeeders />
					<TestResetUtilities />
				</div>
			</div>
		</Layout>
	);
}
