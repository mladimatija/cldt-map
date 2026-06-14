'use client';

import React from 'react';
import { IoChevronDownOutline } from 'react-icons/io5';
import { cn } from '@/lib/utils';

export const MAP_CONTROL_SECTION_HEADING =
	'm-0 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-[var(--text-secondary)]';

interface MapControlSectionCardProps {
	title: string;
	children: React.ReactNode;
	className?: string;
	id?: string;
	collapsible?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	collapseLabel?: string;
	expandLabel?: string;
}

export function MapControlSectionCard({
	title,
	children,
	className,
	id,
	collapsible = false,
	open = true,
	onOpenChange,
	collapseLabel,
	expandLabel,
}: MapControlSectionCardProps): React.ReactElement {
	const headingId = React.useId();

	if (collapsible) {
		return (
			<section
				aria-labelledby={headingId}
				className={cn('rounded-lg border border-gray-200 p-3 dark:border-[var(--border-color)]', className)}
				id={id}
			>
				<button
					aria-controls={`${headingId}-body`}
					aria-expanded={open}
					className="focus-visible:ring-cldt-green flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
					id={headingId}
					type="button"
					onClick={() => onOpenChange?.(!open)}
				>
					<IoChevronDownOutline
						aria-hidden
						className={cn(
							'h-4 w-4 shrink-0 text-gray-500 transition-transform dark:text-[var(--text-secondary)]',
							!open && '-rotate-90',
						)}
					/>
					<span className={MAP_CONTROL_SECTION_HEADING}>{title}</span>
					<span className="sr-only">{open ? collapseLabel : expandLabel}</span>
				</button>
				{open ? (
					<div className="mt-2 flex flex-col gap-2" id={`${headingId}-body`}>
						{children}
					</div>
				) : null}
			</section>
		);
	}

	return (
		<section
			aria-labelledby={headingId}
			className={cn('rounded-lg border border-gray-200 p-3 dark:border-[var(--border-color)]', className)}
			id={id}
		>
			<h4 className={MAP_CONTROL_SECTION_HEADING} id={headingId}>
				{title}
			</h4>
			<div className="mt-2 flex flex-col gap-2">{children}</div>
		</section>
	);
}
