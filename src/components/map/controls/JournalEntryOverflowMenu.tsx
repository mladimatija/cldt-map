'use client';

import React, { useEffect, useRef, useState } from 'react';
import { IoEllipsisHorizontal } from 'react-icons/io5';
import { useEscapeLayer } from '@/hooks/useEscapeLayer';
import { MapControlIconButton } from './MapControlIconButton';
import { cn } from '@/lib/cn';

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
	const menuRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	/** The menu's enabled items, in order: arrow keys move focus among them. */
	const menuItems = (): HTMLButtonElement[] => [
		...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
	];

	/** Closes the menu with focus back on its button, so keyboard users keep their place. */
	const closeMenu = (): void => {
		setOpen(false);
		triggerRef.current?.focus();
	};
	// Escape closes the menu only; the panel it sits in stays open.
	useEscapeLayer(open, closeMenu);

	useEffect(() => {
		if (!open) return;
		menuItems()[0]?.focus();
		const handlePointerDown = (e: MouseEvent | TouchEvent): void => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener('mousedown', handlePointerDown);
		document.addEventListener('touchstart', handlePointerDown);
		return () => {
			document.removeEventListener('mousedown', handlePointerDown);
			document.removeEventListener('touchstart', handlePointerDown);
		};
	}, [open]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
		if (!open) return;
		if (e.key === 'Tab') {
			// Leave from the button, as the focused item is about to unmount.
			closeMenu();
			return;
		}
		const items = menuItems();
		if (items.length === 0) return;
		const current = items.indexOf(document.activeElement as HTMLButtonElement);
		let next: number;
		if (e.key === 'ArrowDown') next = (current + 1) % items.length;
		else if (e.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = items.length - 1;
		else return;
		e.preventDefault();
		items[next].focus();
	};

	return (
		<div className="relative shrink-0" ref={rootRef} onKeyDown={handleKeyDown}>
			<MapControlIconButton
				aria-expanded={open}
				aria-haspopup="menu"
				aria-label={menuLabel}
				ref={triggerRef}
				onClick={() => setOpen((prev) => !prev)}
			>
				<IoEllipsisHorizontal aria-hidden className="h-4 w-4" />
			</MapControlIconButton>
			{open ? (
				<div
					className={cn(
						'z-controls-popover absolute top-full right-0 mt-1 min-w-[9rem] rounded-md border border-gray-200 bg-white py-1 shadow-md',
						'dark:border-[var(--border-color)] dark:bg-[var(--bg-secondary)]',
					)}
					ref={menuRef}
					role="menu"
				>
					<button
						className="block w-full cursor-pointer border-0 bg-transparent px-3 py-1.5 text-left text-xs text-gray-700 outline-none hover:bg-gray-100 focus-visible:bg-gray-100 dark:text-[var(--text-primary)] dark:hover:bg-[var(--bg-hover)] dark:focus-visible:bg-[var(--bg-hover)]"
						role="menuitem"
						tabIndex={-1}
						type="button"
						onClick={() => {
							closeMenu();
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
							tabIndex={-1}
							title={exportGpxTitle}
							type="button"
							onClick={() => {
								if (exportGpxDisabled) return;
								closeMenu();
								onExportGpx();
							}}
						>
							{exportGpxLabel}
						</button>
					) : null}
					<button
						className="text-cldt-red block w-full cursor-pointer border-0 bg-transparent px-3 py-1.5 text-left text-xs outline-none hover:bg-gray-100 focus-visible:bg-gray-100 dark:hover:bg-[var(--bg-hover)] dark:focus-visible:bg-[var(--bg-hover)]"
						role="menuitem"
						tabIndex={-1}
						type="button"
						onClick={() => {
							closeMenu();
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
