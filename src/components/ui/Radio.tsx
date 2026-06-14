'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type RadioProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Styled radio input shared across the app. Native radios take an
 * accent-color, but Chrome darkens the surrounding ring for contrast
 * (rendering near-black next to the teal dot), so the control is drawn from
 * scratch: appearance-none circle, teal fill when checked, with an inset
 * ring matching the panel background to carve out the classic center dot.
 * Pass className to extend or override (merged via tailwind-merge).
 */
const Radio = React.forwardRef<HTMLInputElement, RadioProps>(({ className, ...props }, ref) => (
	<input
		className={cn(
			'h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-gray-300 bg-white',
			'checked:border-(--cldt-blue) checked:bg-(--cldt-blue) checked:shadow-[inset_0_0_0_3px_white]',
			'focus-visible:ring-cldt-green focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
			'disabled:cursor-not-allowed disabled:opacity-50',
			'dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)] dark:checked:border-(--cldt-blue) dark:checked:bg-(--cldt-blue)',
			'dark:checked:shadow-[inset_0_0_0_3px_var(--bg-secondary)]',
			className,
		)}
		ref={ref}
		type="radio"
		{...props}
	/>
));
Radio.displayName = 'Radio';

export { Radio };
