import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combines className strings and Tailwind utility classes
 * Uses clsx to combine class values and twMerge to handle Tailwind-specific merging
 */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
