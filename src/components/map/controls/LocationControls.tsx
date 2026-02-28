'use client';

import React, { useRef } from 'react';
import { useBlockMapPropagation } from '@/hooks';
import LocationButton from './LocationButton';
import UserLocationToggleButton from './UserLocationToggleButton';

interface LocationControlsProps {
	checkPermission?: (prompt: boolean) => Promise<void>;
}

export default function LocationControls({ checkPermission }: LocationControlsProps): React.ReactElement {
	const containerRef = useRef<HTMLDivElement>(null);
	useBlockMapPropagation(containerRef);

	return (
		<div className="z-controls absolute right-2 bottom-2 flex flex-col gap-2" ref={containerRef}>
			<UserLocationToggleButton />
			<LocationButton checkPermission={checkPermission} />
		</div>
	);
}
