import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Shared class fragments (DRY)
const CLDT_HOVER_FOCUS =
	'hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green';
const BORDER_WHITE = 'border border-gray-200 bg-white';
const CONTROL_ROUND_SHAPE =
	'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full shadow-md transition-all outline-none';
const MAP_OPTION_GRID =
	'grid w-full cursor-pointer grid-cols-[32px_1fr] items-center gap-2 border-b border-gray-200 p-2.5 text-left transition-colors outline-none last:border-b-0 dark:border-b-[var(--bg-secondary)] dark:last:border-b-0 hover:bg-gray-100 focus-visible:bg-gray-100 dark:hover:bg-[var(--bg-hover)] dark:focus-visible:bg-[var(--bg-hover)] dark:bg-[var(--bg-secondary)] dark:text-[var(--text-primary)]';
const MAP_OPTION_LEFT_ACCENT =
	'hover:border-l-cldt-green focus-visible:border-l-cldt-green dark:hover:border-l-cldt-green dark:focus-visible:border-l-cldt-green';
const SECONDARY_DARK =
	'dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)] dark:!text-[var(--text-primary)] dark:hover:border-[var(--border-color)] dark:hover:bg-[var(--bg-hover)]';
/** Shared base for secondary-style outline buttons (map control Cancel, tooltip Dismiss). */
const SECONDARY_OUTLINE_BASE = `${BORDER_WHITE} font-medium text-gray-700 transition-all hover:border-gray-300 hover:text-gray-900 focus-visible:border-cldt-green focus-visible:ring-cldt-green ${SECONDARY_DARK}`;

const buttonVariants = cva(
	'cursor-pointer inline-flex items-center justify-center rounded-md font-medium transition-all outline-none focus-visible:outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
	{
		variants: {
			variant: {
				/** Default button style used across the app. */
				base: `${BORDER_WHITE} text-cldt-blue ${CLDT_HOVER_FOCUS} dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)] dark:text-[var(--text-primary)] dark:hover:border-cldt-green dark:hover:text-cldt-green dark:focus-visible:border-cldt-green dark:focus-visible:text-cldt-green`,
				/** Primary CTA. */
				primary: 'bg-cldt-blue text-white border border-transparent hover:bg-cldt-green focus-visible:bg-cldt-green',
				/** Selected / active state. */
				selected: `bg-white border-2 border-cldt-blue text-cldt-blue ${CLDT_HOVER_FOCUS} dark:border-cldt-blue dark:bg-[var(--bg-secondary)] dark:text-cldt-blue dark:hover:border-cldt-green dark:hover:text-cldt-green dark:focus-visible:border-cldt-green dark:focus-visible:text-cldt-green`,
				/** Round map control button (inactive). */
				controlRound: `${CONTROL_ROUND_SHAPE} ${BORDER_WHITE} text-cldt-blue ${CLDT_HOVER_FOCUS} hover:border-2 focus-visible:border-2`,
				/** Round map control button (active/selected or inactive toggle state). */
				controlRoundActive: `${CONTROL_ROUND_SHAPE} border-2 border-cldt-blue bg-white text-cldt-blue ${CLDT_HOVER_FOCUS}`,
				/** Round map control button (locating / loading state). */
				controlRoundLocating: `${CONTROL_ROUND_SHAPE} cursor-wait border border-gray-200 bg-cldt-blue/10 dark:border-[var(--border-color)] dark:bg-cldt-blue/20 dark:text-[var(--text-primary)]`,
				/** Round map control with dark mode styling (e.g., base map trigger). */
				controlRoundDark: `${CONTROL_ROUND_SHAPE} ${BORDER_WHITE} text-cldt-blue ${CLDT_HOVER_FOCUS} hover:border-2 focus-visible:border-2 dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)] dark:text-[var(--text-primary)]`,
				/** Close icon (×) in tooltips/banners; pair with .user-location-close-btn for position/size. */
				closeIcon:
					'h-6 w-6 min-w-0 shrink-0 border-none bg-transparent p-0 text-[#666] text-xl leading-none outline-none hover:bg-black/5 hover:text-cldt-blue focus-visible:bg-black/5 focus-visible:text-cldt-blue rounded',
				/** Base map selector list option. */
				mapOption: `${MAP_OPTION_GRID} border-l-4 border-l-transparent ${MAP_OPTION_LEFT_ACCENT}`,
				/** Base map selector list option (selected). */
				mapOptionActive: `${MAP_OPTION_GRID} border-l-4 border-l-cldt-green bg-cldt-light-blue dark:bg-cldt-light-blue/30`,
				/** Map controls: outline primary action (e.g., Copy link, Go). */
				mapControlOutline: `map-control-btn-outline dark:bg-transparent dark:text-white dark:hover:text-cldt-green text-cldt-blue ${CLDT_HOVER_FOCUS} focus-visible:ring-cldt-green ${BORDER_WHITE} text-sm transition-all focus-visible:ring-1`,
				/** Map controls: outline secondary action (e.g., Cancel). */
				mapControlOutlineSecondary: `focus-visible:ring-1 text-sm ${SECONDARY_OUTLINE_BASE}`,
				/** Buttons inside map tooltips/banners (primary). */
				mapTooltipPrimary: `!text-cldt-blue ${CLDT_HOVER_FOCUS} ${BORDER_WHITE} px-4 py-2 font-medium transition-all`,
				/** Buttons inside map tooltips/banners (secondary). */
				mapTooltipSecondary: `px-4 py-2 focus-visible:ring-2 ${SECONDARY_OUTLINE_BASE}`,
				/** Offline page primary (black). */
				offlinePrimary: 'bg-black text-white hover:bg-black/90 focus-visible:bg-black/90',
				/** Offline page outline. */
				offlineOutline: 'border border-black/15 bg-transparent text-black hover:bg-black/5 focus-visible:bg-black/5',
			},
			size: {
				default: 'px-4 py-2',
				sm: 'px-3 py-1.5 text-sm',
				lg: 'px-6 py-3 text-lg',
				icon: 'h-10 w-10 p-0',
				none: '',
			},
		},
		defaultVariants: {
			variant: 'base',
			size: 'none',
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

/**
 * Button component styled with Tailwind CSS
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
	<button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} type="button" />
));

Button.displayName = 'Button';

export { Button, buttonVariants };
