'use client';

/** Sticky top bar with a primary back-to-map link for content pages (About, Test). */
import React from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/Button';
import { CONTENT_PAGE_CONTAINER } from '@/components/layout/content-page';
import { cn } from '@/lib/utils';

interface BackToMapBarProps {
	className?: string;
	/** Must match the page content wrapper so the back button aligns with the column. */
	containerClassName?: string;
}

export function BackToMapBar({
	className,
	containerClassName = CONTENT_PAGE_CONTAINER,
}: BackToMapBarProps): React.ReactElement {
	const t = useTranslations('common');

	return (
		<div
			className={cn(
				'sticky top-0 z-10 border-b border-gray-200 bg-white dark:border-[var(--border-color)] dark:bg-[var(--bg-primary,#0f172a)]',
				className,
			)}
		>
			<div className={cn(containerClassName, 'py-3')}>
				<Link
					className={cn(
						buttonVariants({ variant: 'primary', size: 'default' }),
						'hover:text-white hover:no-underline focus-visible:text-white focus-visible:no-underline',
					)}
					href="/"
				>
					&larr; {t('backToMap')}
				</Link>
			</div>
		</div>
	);
}
