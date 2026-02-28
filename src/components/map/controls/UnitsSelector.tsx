'use client';

import React from 'react';
import { useStore, type StoreState } from '@/lib/store';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface UnitsSelectorProps {
	className?: string;
}

export default function UnitsSelector({ className }: UnitsSelectorProps): React.ReactElement {
	const units = useStore((state: StoreState) => state.units);
	const setUnits = useStore((state: StoreState) => state.broadcastUnitsChange);

	const toggleUnits = (): void => {
		setUnits(units === 'metric' ? 'imperial' : 'metric');
	};

	return (
		<Button
			className={cn('z-controls absolute bottom-4 left-4 bg-white/90 shadow-md hover:bg-white/95', className)}
			size="sm"
			variant="outline"
			onClick={toggleUnits}
		>
			{units === 'metric' ? 'km' : 'mi'}
		</Button>
	);
}
