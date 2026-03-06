'use client';

import React from 'react';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Button } from '@/components/ui/Button';

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
			<Button
				aria-label={ariaLabel}
				className={className}
				disabled={disabled}
				title={title}
				variant={active ? 'controlRoundActive' : 'controlRound'}
				onClick={onClick}
			>
				{children}
			</Button>
		</SmartTooltip>
	);
}
