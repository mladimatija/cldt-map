'use client';

import React, { useEffect, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import StoreTest from '@/components/StoreTest';
import { Layout } from '@/components/layout/Layout';
import { useTranslations } from 'next-intl';

export default function TestPage(): React.ReactElement {
	const router = useRouter();
	const t = useTranslations('test');
	const [isAllowed, setIsAllowed] = useState(false);

	useEffect(() => {
		if (process.env.NODE_ENV === 'production') {
			router.replace('/');
		} else {
			queueMicrotask(() => setIsAllowed(true));
		}
	}, [router]);

	if (!isAllowed) {
		return (
			<Layout>
				<div className="container mx-auto px-4 py-8">
					<p className="text-gray-500">{t('redirecting')}</p>
				</div>
			</Layout>
		);
	}

	return (
		<Layout>
			<div className="container mx-auto max-w-2xl px-4 py-8">
				<div className="mb-6">
					<Link className="text-cldt-blue font-medium outline-none hover:underline focus-visible:underline" href="/">
						&larr; {t('backToMap')}
					</Link>
				</div>

				<h1 className="mb-2">{t('title')}</h1>
				<p className="mb-6 text-gray-600">{t('description')}</p>

				<StoreTest />
			</div>
		</Layout>
	);
}
