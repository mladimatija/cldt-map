'use client';

import React from 'react';
import SmartTooltip from '@/components/ui/SmartTooltip';
import { Checkbox } from '@/components/ui/Checkbox';
import { IoHelpCircleOutline } from 'react-icons/io5';
import { cn } from '@/lib/utils';

interface SettingsToggleRowProps {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	label: string;
	icon?: React.ReactNode;
	tooltip?: string;
	hint?: string;
	disabled?: boolean;
	className?: string;
}

export function SettingsToggleRow({
	checked,
	onCheckedChange,
	label,
	icon,
	tooltip,
	hint,
	disabled = false,
	className,
}: SettingsToggleRowProps): React.ReactElement {
	return (
		<label
			className={cn(
				'flex cursor-pointer gap-2',
				hint ? 'items-start' : 'items-center',
				disabled && 'pointer-events-none cursor-not-allowed opacity-50',
				className,
			)}
		>
			<Checkbox checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
			{icon ? <span className={cn('shrink-0 text-gray-600 dark:text-white', hint && 'mt-0.5')}>{icon}</span> : null}
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="flex items-center gap-1 text-sm text-gray-700 dark:text-[var(--text-primary)]">
					{label}
					{tooltip ? (
						<span className="inline-flex" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
							<SmartTooltip content={tooltip} position="top">
								<IoHelpCircleOutline className="h-3.5 w-3.5 shrink-0 cursor-help text-gray-400 hover:text-gray-600 dark:text-white" />
							</SmartTooltip>
						</span>
					) : null}
				</span>
				{hint ? <span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">{hint}</span> : null}
			</div>
		</label>
	);
}
