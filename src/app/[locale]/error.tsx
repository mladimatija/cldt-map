'use client';

/** Route error boundary for the locale segment: a retry card instead of a blank page. */
import { useEffect } from 'react';
import { ErrorFallbackCard } from '@/components/common/ErrorBoundary';

export default function LocaleError({ error, retry }: { error: unknown; retry: () => void }): React.ReactElement {
	useEffect(() => {
		console.error('Route error:', error);
	}, [error]);

	// Server errors arrive with a generic production message, so show the
	// localized text instead of `error.message`.
	return <ErrorFallbackCard onRetry={retry} />;
}
