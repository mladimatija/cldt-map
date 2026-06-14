'use client';

/** App shell: header, scrollable main content, footer. Header and footer are loaded dynamically (no SSR). */
import React from 'react';
import { cn } from '@/lib/utils';
import dynamic from 'next/dynamic';

const Header = dynamic(() => import('@/components/layout/Header').then((mod) => mod.Header), { ssr: false });
const Footer = dynamic(() => import('@/components/layout/Footer').then((mod) => mod.Footer), { ssr: false });
const PwaInstallPrompt = dynamic(() => import('@/components/common/PwaInstallPrompt').then((mod) => mod.default), {
	ssr: false,
});

interface LayoutProps {
	children: React.ReactNode;
	className?: string;
	/** Overlay header on the main surface (default). Set false on content pages with BackToMapBar. */
	overlayHeader?: boolean;
	/** When false, the CLDT logo header is omitted (e.g. Test page). */
	showHeader?: boolean;
}

export function Layout({
	children,
	className,
	overlayHeader = true,
	showHeader = true,
}: LayoutProps): React.ReactElement {
	return (
		<div className="flex h-screen flex-col overflow-hidden">
			{showHeader ? <Header overlay={overlayHeader} /> : null}
			<main className={cn('min-h-0 flex-1 overflow-y-auto', className)}>{children}</main>
			<Footer />
			<PwaInstallPrompt />
		</div>
	);
}
