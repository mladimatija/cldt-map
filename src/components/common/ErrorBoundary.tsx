'use client';

/** Catches React errors in the tree and shows a fallback UI (or custom fallback prop) with a refresh button. */
import { Component, ErrorInfo, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/Card';

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

function ErrorBoundaryFallback({ error }: { error: Error | null }): React.ReactElement {
	const t = useTranslations('error');
	return (
		<div className="flex min-h-screen items-center justify-center p-4">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>{t('somethingWentWrong')}</CardTitle>
					<CardDescription>{error?.message || t('unexpectedError')}</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground text-sm">{t('tryRefreshing')}</p>
				</CardContent>
				<CardFooter>
					<Button onClick={() => window.location.reload()}>{t('refreshPage')}</Button>
				</CardFooter>
			</Card>
		</div>
	);
}

export class ErrorBoundary extends Component<Props, State> {
	public state: State = {
		hasError: false,
		error: null,
	};

	public static getDerivedStateFromError(error: Error): State {
		return {
			hasError: true,
			error,
		};
	}

	public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error('Uncaught error:', error, errorInfo);
	}

	public render(): ReactNode {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback;
			}
			return <ErrorBoundaryFallback error={this.state.error} />;
		}

		return this.props.children;
	}
}

export default ErrorBoundary;
