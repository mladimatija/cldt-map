'use client';

/** Custom language dropdown for the footer. Opens upward; closes on Escape or outside click. */
import React, { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { IoCheckmark, IoLanguageOutline } from 'react-icons/io5';
import { MdKeyboardArrowDown, MdKeyboardArrowUp } from 'react-icons/md';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { useClientLocale } from '@/components/providers/ClientIntlProvider';
import { cn } from '@/lib/utils';

export function LanguageSwitcher(): React.ReactElement {
	const t = useTranslations('footer');
	const locale = useLocale() as Locale;
	const pathname = usePathname();
	const router = useRouter();
	const { setLocale } = useClientLocale();
	const [isOpen, setIsOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!isOpen) return;
		const handler = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') setIsOpen(false);
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) return;
		const handler = (e: MouseEvent): void => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		};
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, [isOpen]);

	const handleSelect = (next: Locale): void => {
		setLocale(next);
		router.push(pathname, { locale: next });
		setIsOpen(false);
	};

	return (
		<div className="relative" ref={containerRef}>
			<button
				aria-expanded={isOpen}
				aria-haspopup="listbox"
				aria-label={t('language')}
				className="hover:text-cldt-green focus-visible:text-cldt-green flex cursor-pointer items-center gap-1 text-sm font-medium text-white transition-colors outline-none"
				type="button"
				onClick={() => setIsOpen((v) => !v)}
			>
				<IoLanguageOutline aria-hidden className="h-4 w-4 shrink-0" />
				<span>{t(locale)}</span>
				{isOpen ? (
					<MdKeyboardArrowUp aria-hidden className="h-4 w-4 shrink-0" />
				) : (
					<MdKeyboardArrowDown aria-hidden className="h-4 w-4 shrink-0" />
				)}
			</button>

			{isOpen && (
				<ul
					aria-label={t('language')}
					className="absolute right-0 bottom-full z-(--z-controls-popover) mb-2 min-w-[8rem] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800"
					role="listbox"
				>
					{routing.locales.map((loc) => {
						const isActive = loc === locale;
						return (
							<li aria-selected={isActive} key={loc} role="option">
								<button
									className={cn(
										'flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors outline-none',
										isActive
											? 'bg-cldt-light-blue text-cldt-green dark:bg-cldt-light-blue/20 font-medium'
											: 'text-gray-700 hover:bg-gray-100 focus-visible:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700 dark:focus-visible:bg-gray-700',
									)}
									type="button"
									onClick={() => handleSelect(loc)}
								>
									<IoCheckmark
										aria-hidden
										className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-cldt-green' : 'invisible')}
									/>
									{t(loc)}
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
