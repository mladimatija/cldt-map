'use client';

import React from 'react';
import { Button, type ButtonProps } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

export interface MapControlIconButtonProps extends Omit<ButtonProps, 'size'> {
	'aria-label': string;
	title?: string;
	children: React.ReactNode;
}

const ICON_BUTTON_CLASS = 'h-8 w-8 shrink-0 px-0';

export function MapControlIconButton({
	className,
	variant = 'base',
	title,
	children,
	'aria-label': ariaLabel,
	...props
}: MapControlIconButtonProps): React.ReactElement {
	return (
		<Button
			aria-label={ariaLabel}
			className={cn(ICON_BUTTON_CLASS, className)}
			size="sm"
			title={title ?? ariaLabel}
			variant={variant}
			{...props}
		>
			{children}
		</Button>
	);
}
