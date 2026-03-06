'use client';

/** Bottom bar: copyright, about link, language switcher, GitHub link. Uses ClientIntlProvider for locale. */
import { Link } from '@/i18n/navigation';
import { FaGithub } from 'react-icons/fa';
import { useSiteMetadata } from '@/hooks';
import { ExternalLink } from '@/components/ui/ExternalLink';
import { Button } from '@/components/ui/Button';
import { useLocale, useTranslations } from 'next-intl';
import { JSX } from 'react';
import { useClientLocale } from '@/components/providers/ClientIntlProvider';

export function Footer(): JSX.Element {
	const { authorName, authorUrl, githubUrl, title } = useSiteMetadata();
	const t = useTranslations('footer');
	const locale = useLocale();
	const { setLocale } = useClientLocale();

	return (
		<footer className="bg-cldt-blue shadow-t-md sticky bottom-0 flex flex-col gap-2 p-3 text-white sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4">
			<p className="m-0 shrink-0 text-center text-sm text-white sm:text-left">
				Copyright &copy; 2026{' '}
				<ExternalLink
					className="hover:text-cldt-green focus-visible:text-cldt-green font-medium text-white transition-colors duration-200 outline-none hover:no-underline focus-visible:no-underline"
					href={authorUrl}
				>
					{authorName}
				</ExternalLink>
			</p>

			<p className="m-0 min-w-0 flex-1 basis-full text-center text-sm text-white sm:flex-initial sm:basis-auto sm:text-left">
				{t('description')}
			</p>
			<div className="flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-end">
				<Link
					className="hover:text-cldt-green focus-visible:text-cldt-green font-medium text-white transition-colors duration-200 outline-none hover:no-underline focus-visible:no-underline"
					href="/about"
				>
					{t('about')}
				</Link>
				<span className="mx-2 text-white opacity-70">|</span>
				<span className="flex items-center gap-1">
					<Button
						aria-current={locale === 'en' ? 'true' : undefined}
						title={t('switchToEn')}
						type="button"
						variant={locale === 'en' ? 'footerLangActive' : 'footerLang'}
						onClick={() => setLocale('en')}
					>
						{t('en')}
					</Button>
					<span className="text-white opacity-50">|</span>
					<Button
						aria-current={locale === 'hr' ? 'true' : undefined}
						title={t('switchToHr')}
						type="button"
						variant={locale === 'hr' ? 'footerLangActive' : 'footerLang'}
						onClick={() => setLocale('hr')}
					>
						{t('hr')}
					</Button>
				</span>
				<span className="mx-2 text-white opacity-70">|</span>
				<ExternalLink
					className="text-cldt-light-blue focus-visible:text-cldt-light-blue hover:text-cldt-light-blue font-medium text-white transition-colors duration-200 outline-none hover:no-underline focus-visible:no-underline"
					href={githubUrl}
					title={t('githubLabel', { title })}
				>
					<span className="sr-only">{t('githubLabel', { title })}</span>
					<FaGithub size={20} />
				</ExternalLink>
			</div>
		</footer>
	);
}
