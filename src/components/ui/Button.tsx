import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
	'cursor-pointer inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed',
	{
		variants: {
			variant: {
				default: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:bg-blue-700',
				destructive: 'bg-cldt-red text-white hover:opacity-90 focus-visible:opacity-90',
				outline: 'border border-gray-300 bg-white hover:bg-gray-100 focus-visible:bg-gray-100',
				secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200 focus-visible:bg-gray-200',
				ghost: 'hover:bg-gray-100 hover:text-gray-900 focus-visible:bg-gray-100 focus-visible:text-gray-900',
				link: 'text-blue-600 underline-offset-4 hover:underline focus-visible:underline',
			},
			size: {
				default: 'h-10 px-4 py-2',
				sm: 'h-8 rounded-md px-3 text-sm',
				lg: 'h-12 rounded-md px-6 text-lg',
				icon: 'h-10 w-10',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

/**
 * Button component styled with Tailwind CSS
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
	<button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
));

Button.displayName = 'Button';

export { Button, buttonVariants };
