'use client';

import React, { type RefObject } from 'react';
import { Link } from '@/i18n/navigation';
import { IoSettingsOutline } from 'react-icons/io5';

interface MapControlsTestLinkProps {
	containerRef: RefObject<HTMLDivElement | null>;
	label: string;
}

/** Dev-only link to /test store page. */
export function MapControlsTestLink({ containerRef, label }: MapControlsTestLinkProps): React.ReactElement {
	return (
		<div className="z-controls absolute top-40 left-2" ref={containerRef}>
			<Link
				className="text-cldt-blue hover:border-cldt-green hover:text-cldt-green focus-visible:border-cldt-green focus-visible:text-cldt-green flex cursor-pointer items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-sm shadow-md transition-all outline-none"
				href="/test"
			>
				<IoSettingsOutline className="h-4 w-4" />
				<span>{label}</span>
			</Link>
		</div>
	);
}
