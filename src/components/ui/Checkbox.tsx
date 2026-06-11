'use client';

import * as React from 'react';
import { IoCheckmark } from 'react-icons/io5';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
	checked?: boolean;
	onCheckedChange?: (checked: boolean) => void;
}

/**
 * Styled checkbox. Implemented as a button with role="checkbox" rather than a
 * native input on purpose: the previous controlled-input version desynced
 * under rapid clicks - React's change-event value tracker swallowed the
 * second native toggle of a double click, leaving the CSS :checked state
 * (background) contradicting the React prop (checkmark glyph). With a button
 * there is no native checked state at all: the store value is the single
 * source of truth, every click is one deterministic toggle, and an outer
 * <label> still forwards text clicks here (buttons are labelable elements).
 */
const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
	({ className, checked = false, onCheckedChange, onClick, ...props }, ref) => {
		const handleClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
			onClick?.(e);
			if (!e.defaultPrevented) onCheckedChange?.(!checked);
		};

		return (
			<button
				aria-checked={checked}
				className={cn(
					'flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors',
					checked
						? 'border-cldt-blue bg-cldt-blue text-white'
						: 'border-gray-300 bg-white dark:border-white dark:bg-transparent',
					'focus-visible:ring-cldt-green focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-none',
					'disabled:cursor-not-allowed disabled:opacity-50',
					className,
				)}
				ref={ref}
				role="checkbox"
				type="button"
				onClick={handleClick}
				{...props}
			>
				{checked && <IoCheckmark aria-hidden className="h-3 w-3" />}
			</button>
		);
	},
);

Checkbox.displayName = 'Checkbox';

export { Checkbox };
