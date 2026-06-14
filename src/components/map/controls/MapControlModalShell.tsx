'use client';

import React, { useEffect } from 'react';
import { IoCloseOutline } from 'react-icons/io5';
import { usePopoverFocusTrap } from '@/hooks';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface MapControlModalShellProps {
	open: boolean;
	onClose: () => void;
	title: string;
	titleId: string;
	children: React.ReactNode;
	cardClassName?: string;
	cardStyle?: React.CSSProperties;
	titleClassName?: string;
	titleStyle?: React.CSSProperties;
	showCloseButton?: boolean;
	closeLabel?: string;
	backdropClassName?: string;
}

/**
 * Shared modal shell for map control dialogs: backdrop, focus trap,
 * Escape and backdrop dismiss, optional close control.
 */
export function MapControlModalShell({
	open,
	onClose,
	title,
	titleId,
	children,
	cardClassName,
	cardStyle,
	titleClassName,
	titleStyle,
	showCloseButton = true,
	closeLabel,
	backdropClassName,
}: MapControlModalShellProps): React.ReactElement | null {
	const cardRef = usePopoverFocusTrap(open);

	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div
			aria-labelledby={titleId}
			aria-modal="true"
			className={cn(
				'z-modal fixed inset-0 flex items-center justify-center bg-[var(--modal-backdrop-bg)] p-4',
				backdropClassName,
			)}
			role="dialog"
			onClick={onClose}
		>
			<div
				className={cn(
					'relative flex max-h-[90dvh] w-full max-w-lg flex-col gap-2 overflow-y-auto rounded bg-[var(--map-tooltip-bg)] p-4 shadow-xl dark:bg-[var(--bg-primary)]',
					cardClassName,
				)}
				ref={cardRef}
				style={cardStyle}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="relative shrink-0">
					{showCloseButton && closeLabel ? (
						<Button
							aria-label={closeLabel}
							className="absolute top-0 right-0"
							title={closeLabel}
							variant="closeIcon"
							onClick={onClose}
						>
							<IoCloseOutline aria-hidden className="h-4 w-4" />
						</Button>
					) : null}
					<h3
						className={cn(
							'm-0 pr-7 text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]',
							!showCloseButton && 'pr-0',
							titleClassName,
						)}
						id={titleId}
						style={titleStyle}
					>
						{title}
					</h3>
				</div>
				{children}
			</div>
		</div>
	);
}
