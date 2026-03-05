'use client';

import React from 'react';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { CONTROL_BTN_BASE, CONTROL_BTN_ACTIVE, CONTROL_BTN_INACTIVE } from './map-controls-constants';
import { cn } from '@/lib/utils';

interface MapControlButtonProps {
	content: string;
	ariaLabel: string;
	active?: boolean;
	onClick?: () => void;
	disabled?: boolean;
	title?: string;
	children: React.ReactNode;
	className?: string;
}

/** Round map control button with tooltip; used for boundary, ruler, tiles, etc. */
export function MapControlsButton({
	content,
	ariaLabel,
	active = false,
	onClick,
	disabled = false,
	title,
	children,
	className,
}: MapControlButtonProps): React.ReactElement {
	return (
		<SmartTooltip content={content} position="left">
			<button
				aria-label={ariaLabel}
				className={cn(
					CONTROL_BTN_BASE,
					active ? CONTROL_BTN_ACTIVE : CONTROL_BTN_INACTIVE,
					disabled && 'cursor-not-allowed opacity-50',
					className,
				)}
				disabled={disabled}
				title={title}
				type="button"
				onClick={onClick}
			>
				{children}
			</button>
		</SmartTooltip>
	);
}
