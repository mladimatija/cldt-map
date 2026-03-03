import { CLDT_RED } from '@/lib/theme-colors';

export interface TrailSection {
	/** Translation key for the section name (e.g. 'sectionA'). */
	nameKey: string;
	shortName: string;
	color: string;
	startKm: number;
	endKm: number;
}

/**
 * Trail section definitions.
 * The last section should use endKm: Infinity to capture all remaining points.
 */
export const TRAIL_SECTIONS: TrailSection[] = [
	{ nameKey: 'sectionA', shortName: 'A', color: '#5ec687', startKm: 0, endKm: 585.7 },
	{ nameKey: 'sectionB', shortName: 'B', color: '#00a6c7', startKm: 585.7, endKm: 1220.23 },
	{ nameKey: 'sectionC', shortName: 'C', color: CLDT_RED, startKm: 1220.23, endKm: Infinity },
];
