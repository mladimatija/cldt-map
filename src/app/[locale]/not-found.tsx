'use client';

/**
 * 404 Not Found: Shown when a page doesn't exist.
 * Client component so it uses locale from ClientIntlProvider (which reads cldt-map-locale from localStorage; defaults to EN).
 */
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export default function NotFound(): React.ReactElement {
	const t = useTranslations('notFound');

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-white px-4 py-12 dark:bg-[var(--bg-primary,#0f172a)]">
			<div className="mx-auto flex max-w-md flex-col items-center text-center">
				<Image priority alt="" className="mb-8 h-auto w-64 sm:w-80" height={340} src="/404.webp" width={400} />
				<h1 className="text-cldt-blue mb-3 text-2xl font-bold sm:text-3xl">{t('title')}</h1>
				<p className="mb-8 text-base text-gray-600 dark:text-[var(--text-secondary,#94a3b8)]">{t('subtitle')}</p>
				<Link
					className="bg-cldt-blue hover:bg-cldt-green focus-visible:bg-cldt-green inline-block rounded px-6 py-3 font-medium text-white transition-colors duration-200 outline-none hover:text-white hover:no-underline focus-visible:text-white focus-visible:no-underline"
					href="/"
				>
					{t('backToMap')}
				</Link>
			</div>
		</div>
	);
}
