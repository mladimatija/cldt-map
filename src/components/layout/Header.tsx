'use client';

/** Top-left logo linking to the CLDT site; uses site metadata for label and URL. */
import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useSiteMetadata } from '@/hooks';

interface HeaderProps {
	className?: string;
	/** When true, logo overlays the main surface (map). When false, logo sits in the page chrome above scrollable content. */
	overlay?: boolean;
}

export function Header({ className, overlay = true }: HeaderProps): React.ReactElement {
	const { companyName, companyUrl } = useSiteMetadata();

	const logoLink = (
		<Link
			className={cn('block w-[50px] md:w-[100px]', overlay && 'pointer-events-auto')}
			href={companyUrl}
			target="_blank"
			title={companyName}
		>
			<Image
				priority
				alt={companyName}
				className="block h-auto w-full"
				height={102}
				sizes="(max-width: 767px) 50px, 100px"
				src="/cldt-logo.svg"
				style={{ height: 'auto' }}
				width={100}
			/>
		</Link>
	);

	return (
		<header
			className={cn(
				overlay
					? 'pointer-events-none absolute top-2 left-2 z-[410]'
					: 'shrink-0 bg-white py-2 dark:bg-[var(--bg-primary,#0f172a)]',
				className,
			)}
		>
			{overlay ? logoLink : <div className="container mx-auto px-4">{logoLink}</div>}
		</header>
	);
}
