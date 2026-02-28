'use client';

/** Top-left logo linking to the CLDT site; uses site metadata for label and URL. */
import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useSiteMetadata } from '@/hooks';

interface HeaderProps {
	className?: string;
}

export function Header({ className }: HeaderProps): React.ReactElement {
	const { companyName, companyUrl } = useSiteMetadata();

	return (
		<header className={cn('absolute top-2 left-2 z-410', className)}>
			<Link href={companyUrl} target="_blank" title={companyName}>
				<Image priority alt={companyName} height={102} src="/cldt-logo.svg" width={100} />
			</Link>
		</header>
	);
}
