'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { MAP_CONTROL_INPUT } from './map-controls-constants';

interface MapControlInlineNameFormProps {
	ariaLabel: string;
	cancelLabel: string;
	confirmLabel: string;
	placeholder: string;
	value: string;
	onCancel: () => void;
	onChange: (value: string) => void;
	onConfirm: () => void;
}

/** Shared inline name input + confirm/cancel buttons for map control panels. */
export function MapControlInlineNameForm({
	ariaLabel,
	cancelLabel,
	confirmLabel,
	placeholder,
	value,
	onCancel,
	onChange,
	onConfirm,
}: MapControlInlineNameFormProps): React.ReactElement {
	return (
		<div className="flex flex-col gap-1">
			<input
				aria-label={ariaLabel}
				className={cn(MAP_CONTROL_INPUT, 'w-full text-xs')}
				placeholder={placeholder}
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter') onConfirm();
					if (e.key === 'Escape') onCancel();
				}}
			/>
			<div className="flex gap-1">
				<Button disabled={!value.trim()} size="sm" variant="mapControlOutline" onClick={onConfirm}>
					{confirmLabel}
				</Button>
				<Button size="sm" variant="mapControlOutlineSecondary" onClick={onCancel}>
					{cancelLabel}
				</Button>
			</div>
		</div>
	);
}
