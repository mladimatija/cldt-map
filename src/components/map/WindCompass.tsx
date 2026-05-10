'use client';

/**
 * Pure presentational compass: a 32x32 SVG showing wind direction relative
 * to the active travel bearing. The textual `label` is the accessible content
 * (e.g. "Headwind 12°"); the SVG itself is `aria-hidden`.
 *
 * Conventions:
 * - relativeAngle is in (-180, 180] and points toward the wind's source.
 *   0 = wind from the direction of travel (headwind); ±180 = wind from behind
 *   (tailwind).
 * - The reference arrow always points up — it represents the trail bearing.
 * - The colored wind arrow is rotated by `relativeAngle` (clockwise, SVG-positive),
 *   so it visually points to where the wind is coming from.
 */
import React from 'react';
import { classifyWind } from '@/lib/distance-utils';

interface WindCompassProps {
	relativeAngle: number;
	label: string;
}

const COLOR_BY_CLASS = {
	tailwind: 'text-cldt-blue',
	crosswind: 'text-gray-500',
	headwind: 'text-cldt-red',
} as const;

export function WindCompass({ relativeAngle, label }: WindCompassProps): React.ReactElement {
	const colorClass = COLOR_BY_CLASS[classifyWind(relativeAngle)];

	return (
		<span className="inline-flex items-center gap-2">
			<svg
				aria-hidden="true"
				className={`shrink-0 ${colorClass}`}
				fill="none"
				height="32"
				viewBox="0 0 32 32"
				width="32"
				xmlns="http://www.w3.org/2000/svg"
			>
				{/* Compass ring */}
				<circle cx="16" cy="16" fill="none" r="14" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
				{/* Faint reference arrow (trail bearing - always up) */}
				<path
					d="M16 6 L13 12 L16 10 L19 12 Z"
					fill="currentColor"
					stroke="currentColor"
					strokeLinejoin="round"
					strokeOpacity="0.35"
					strokeWidth="0.75"
				/>
				{/* Wind arrow rotated by relativeAngle around centre */}
				<g transform={`rotate(${relativeAngle} 16 16)`}>
					<path
						d="M16 4 L11 14 L16 11 L21 14 Z"
						fill="currentColor"
						stroke="currentColor"
						strokeLinejoin="round"
						strokeWidth="1"
					/>
					<line stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" x1="16" x2="16" y1="11" y2="26" />
				</g>
			</svg>
			<span className="text-xs">{label}</span>
		</span>
	);
}
