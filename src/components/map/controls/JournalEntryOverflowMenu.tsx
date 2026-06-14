'use client';

import React, { useEffect, useRef, useState } from 'react';
import { IoEllipsisHorizontal } from 'react-icons/io5';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface JournalEntryOverflowMenuProps {
	menuLabel: string;
	editLabel: string;
	exportGpxLabel: string;
	deleteLabel: string;
	exportGpxDisabled?: boolean;
	exportGpxTitle?: string;
	showExportGpx?: boolean;
	onEdit: () => void;
	onExportGpx?: () => void;
	onDelete: () => void;
}

export function JournalEntryOverflowMenu({
	menuLabel,
	editLabel,
	exportGpxLabel,
	deleteLabel,
	exportGpxDisabled = false,
	exportGpxTitle,
	showExportGpx = false,
	onEdit,
	onExportGpx,
	onDelete,
}: JournalEntryOverflowMenuProps): React.ReactElement {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handlePointerDown = (e: MouseEvent | TouchEvent): void => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') setOpen(false);
		};
		document.addEventListener('mousedown', handlePointerDown);
		document.addEventListener('touchstart', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('mousedown', handlePointerDown);
			document.removeEventListener('touchstart', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [open]);

	return (
		<div className="relative shrink-0" ref={rootRef}>
			<Button
				aria-expanded={open}
				aria-haspopup="menu"
				aria-label={menuLabel}
				className="h-8 w-8 shrink-0 px-0"
				size="sm"
				title={menuLabel}
				variant="base"
				onClick={() => setOpen((prev) => !prev)}
			>
				<IoEllipsisHorizontal aria-hidden className="h-4 w-4" />
			</Button>
			{open ? (
				<div
					className={cn(
						'z-controls-popover absolute top-full right-0 mt-1 min-w-[9rem] rounded-md border border-gray-200 bg-white py-1 shadow-md',
						'dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)]',
					)}
					role="menu"
				>
					<button
						className="block w-full cursor-pointer border-0 bg-transparent px-3 py-1.5 text-left text-xs text-gray-700 outline-none hover:bg-gray-100 focus-visible:bg-gray-100 dark:text-[var(--text-primary)] dark:hover:bg-[var(--bg-hover)] dark:focus-visible:bg-[var(--bg-hover)]"
						role="menuitem"
						type="button"
						onClick={() => {
							setOpen(false);
							onEdit();
						}}
					>
						{editLabel}
					</button>
					{showExportGpx && onExportGpx ? (
						<button
							className="block w-full cursor-pointer border-0 bg-transparent px-3 py-1.5 text-left text-xs text-gray-700 outline-none hover:bg-gray-100 focus-visible:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[var(--text-primary)] dark:hover:bg-[var(--bg-hover)] dark:focus-visible:bg-[var(--bg-hover)]"
							disabled={exportGpxDisabled}
							role="menuitem"
							title={exportGpxTitle}
							type="button"
							onClick={() => {
								if (exportGpxDisabled) return;
								setOpen(false);
								onExportGpx();
							}}
						>
							{exportGpxLabel}
						</button>
					) : null}
					<button
						className="text-cldt-red block w-full cursor-pointer border-0 bg-transparent px-3 py-1.5 text-left text-xs outline-none hover:bg-gray-100 focus-visible:bg-gray-100 dark:hover:bg-[var(--bg-hover)] dark:focus-visible:bg-[var(--bg-hover)]"
						role="menuitem"
						type="button"
						onClick={() => {
							setOpen(false);
							onDelete();
						}}
					>
						{deleteLabel}
					</button>
				</div>
			) : null}
		</div>
	);
}
