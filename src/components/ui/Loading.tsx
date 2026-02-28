import React from 'react';
import { cn } from '@/lib/utils';

interface LoadingProps {
	text?: string;
	className?: string;
}

/**
 * Loading component displays a spinner with optional text
 */
export default function Loading({ text, className }: LoadingProps): React.ReactElement {
	return (
		<div className={cn('flex flex-col items-center justify-center', className)}>
			<div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
			{text && <p className="mt-4 text-gray-600">{text}</p>}
		</div>
	);
}
