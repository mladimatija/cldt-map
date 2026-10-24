'use client';

/** Catches React errors in the tree and shows a fallback UI (or custom fallback prop) with a refresh button. */
import { Component, ErrorInfo, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/Card';

interface Props {
	children: ReactNode;
	/** Rendered instead of the children after an error. `null` hides the failed
	 *  subtree (a map layer that throws disappears). Omit for the full-page card. */
	fallback?: ReactNode;
	/** Label for the console error, e.g. the layer name. */
	name?: string;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

interface ErrorFallbackCardProps {
	message?: string | null;
	/** Re-renders the failed segment without a full reload (route error boundaries). */
	onRetry?: () => void;
}

/** Full-page "Something went wrong" card shared by ErrorBoundary and the route error boundary. */
export function ErrorFallbackCard({ message, onRetry }: ErrorFallbackCardProps): React.ReactElement {
	const t = useTranslations('error');
	return (
		<div className="flex min-h-screen items-center justify-center p-4">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>{t('somethingWentWrong')}</CardTitle>
					<CardDescription>{message || t('unexpectedError')}</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground text-sm">{t('tryRefreshing')}</p>
				</CardContent>
				<CardFooter className="gap-2">
					{onRetry && (
						<Button size="default" variant="primary" onClick={onRetry}>
							{t('tryAgain')}
						</Button>
					)}
					<Button size="default" variant={onRetry ? 'base' : 'primary'} onClick={() => window.location.reload()}>
						{t('refreshPage')}
					</Button>
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
		console.error(`Uncaught error${this.props.name ? ` in ${this.props.name}` : ''}:`, error, errorInfo);
	}

	public render(): ReactNode {
		if (this.state.hasError) {
			if (this.props.fallback !== undefined) {
				return this.props.fallback;
			}
			return <ErrorFallbackCard message={this.state.error?.message} />;
		}

		return this.props.children;
	}
}

export default ErrorBoundary;
