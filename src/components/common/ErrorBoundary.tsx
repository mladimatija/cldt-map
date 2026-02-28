'use client';

/** Catches React errors in the tree and shows a fallback UI (or custom fallback prop) with a refresh button. */
import { Component, ErrorInfo, ReactNode } from 'react';
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

			return (
				<div className="flex min-h-screen items-center justify-center p-4">
					<Card className="w-full max-w-md">
						<CardHeader>
							<CardTitle>Something went wrong</CardTitle>
							<CardDescription>{this.state.error?.message || 'An unexpected error occurred'}</CardDescription>
						</CardHeader>
						<CardContent>
							<p className="text-muted-foreground text-sm">
								Please try refreshing the page or contact support if the problem persists.
							</p>
						</CardContent>
						<CardFooter>
							<Button onClick={() => window.location.reload()}>Refresh Page</Button>
						</CardFooter>
					</Card>
				</div>
			);
		}

		return this.props.children;
	}
}

export default ErrorBoundary;
