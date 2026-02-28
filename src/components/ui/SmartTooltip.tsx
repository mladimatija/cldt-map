'use client';

import React from 'react';
import { Tooltip } from '@/components/ui/Tooltip';

interface SmartTooltipProps {
	children: React.ReactNode;
	content: string;
	position?: 'top' | 'bottom' | 'left' | 'right';
	offset?: number;
	delay?: number;
}

/**
 * SmartTooltip uses custom positioned tooltips with native title as fallback
 * when the custom tooltip is not visible.
 */
const SmartTooltip: React.FC<SmartTooltipProps> = ({
	children,
	content,
	position = 'top',
	offset = 8,
	delay = 300,
}) => {
	if (React.isValidElement(children)) {
		const childWithoutTitle = React.cloneElement(children, {
			title: '',
		} as React.HTMLAttributes<HTMLElement>);
		return (
			<Tooltip content={content} delay={delay} offset={offset} position={position} title={content}>
				{childWithoutTitle}
			</Tooltip>
		);
	}

	return (
		<Tooltip content={content} delay={delay} offset={offset} position={position} title={content}>
			<span>{children}</span>
		</Tooltip>
	);
};

export default SmartTooltip;
