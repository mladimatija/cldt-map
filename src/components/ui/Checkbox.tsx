'use client';

import * as React from 'react';
import { IoCheckmark } from 'react-icons/io5';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
	checked?: boolean;
	onCheckedChange?: (checked: boolean) => void;
}

/**
 * Styled checkbox component using Tailwind. Uses a hidden native input for accessibility
 * with a custom visual appearance.
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
	({ className, checked, onCheckedChange, onChange, ...props }, ref) => {
		const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
			onChange?.(e);
			onCheckedChange?.(e.target.checked);
		};

		return (
			<label className="relative inline-flex cursor-pointer items-center">
				<input
					checked={checked}
					className="peer sr-only"
					ref={ref}
					type="checkbox"
					onChange={handleChange}
					{...props}
				/>
				<span
					aria-hidden
					className={cn(
						'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
						'border-gray-300 bg-white dark:border-white dark:bg-transparent',
						'peer-checked:border-cldt-blue peer-checked:bg-cldt-blue peer-checked:text-white',
						'peer-focus-visible:ring-cldt-green peer-focus-visible:ring-1 peer-focus-visible:ring-offset-1',
						'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
						className,
					)}
				>
					{checked && <IoCheckmark className="h-3 w-3" />}
				</span>
			</label>
		);
	},
);

Checkbox.displayName = 'Checkbox';

export { Checkbox };
