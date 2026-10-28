'use client';

import React, { useCallback, MutableRefObject } from 'react';
import { TrailDirection, UnitSystem } from '@/lib/store';
import { type Poi } from '@/lib/pois';
import { WATER_COLOR } from '@/lib/water-intelligence';
import { type SortMode } from '@/hooks';
import { cn } from '@/lib/cn';
import { formatDistance } from '@/lib/format';
import { formatKm } from '@/lib/units';
import { Checkbox } from '@/components/ui/Checkbox';
import { toTravelKm } from '@/lib/trail-frame';

export interface PoiListRowProps {
	poi: Poi;
	index: number;
	isActive: boolean;
	isSelected: boolean;
	isStarred: boolean;
	displayName: string;
	sort: SortMode;
	direction: TrailDirection;
	totalKm: number;
	units: UnitSystem;
	distancePrecision: number;
	hasGps: boolean;
	gpsDistanceM: number | undefined;
	aheadKm: number | undefined;
	rowRefsRef: MutableRefObject<(HTMLDivElement | null)[]>;
	tStarAdd: string;
	tStarRemove: string;
	tExportSelect: string;
	tExportDeselect: string;
	tType: string;
	/** Translated water reliability label; empty string for non-water rows. */
	tWater: string;
	tOffTrailShort: (distance: string) => string;
	tFromYou: (distance: string) => string;
	tAheadOfYou: (distance: string) => string;
	onPick: () => void;
	onToggleStar: () => void;
	onToggleSelected: () => void;
}

/** Memoized row so React can skip re-rendering unchanged rows when the cursor
 *  moves or a single selection toggles - cuts per-interaction work from O(N)
 *  to O(1) for the changed row. */
export const PoiListRow = React.memo(function PoiListRow({
	poi,
	index,
	isActive,
	isSelected,
	isStarred,
	displayName,
	sort,
	direction,
	totalKm,
	units,
	distancePrecision,
	hasGps,
	gpsDistanceM,
	aheadKm,
	rowRefsRef,
	tStarAdd,
	tStarRemove,
	tExportSelect,
	tExportDeselect,
	tType,
	tWater,
	tOffTrailShort,
	tFromYou,
	tAheadOfYou,
	onPick,
	onToggleStar,
	onToggleSelected,
}: PoiListRowProps): React.ReactElement {
	// Stable ref callback - writes to the parent's rowRefs array at the slot
	// for this row's index. Using useCallback with [index, rowRefsRef] avoids
	// creating a new function on every render while still correctly targeting
	// the right slot if the row's position changes.
	const assignRef = useCallback(
		(el: HTMLDivElement | null) => {
			rowRefsRef.current[index] = el;
		},
		[index, rowRefsRef],
	);
	const displayKm = toTravelKm(poi.trailKm, direction, totalKm);
	const distLabel = formatDistance(displayKm, units, distancePrecision);
	const offTrailLabel = poi.distanceFromTrailKm >= 0.5 ? formatKm(poi.distanceFromTrailKm, units, 1) : '';
	const gpsLabel =
		hasGps && typeof gpsDistanceM === 'number' ? formatDistance(gpsDistanceM, units, distancePrecision, true) : '';
	const aheadLabel =
		sort === 'ahead' && typeof aheadKm === 'number'
			? tAheadOfYou(formatDistance(aheadKm, units, distancePrecision))
			: '';
	return (
		<div
			className={cn(
				'group hover:bg-cldt-blue/10 dark:hover:bg-cldt-blue/20 flex w-full items-stretch gap-1 rounded',
				isSelected && 'bg-cldt-blue/5 dark:bg-cldt-blue/15',
				isActive && 'ring-cldt-blue ring-2',
			)}
			key={poi.id}
			ref={assignRef}
		>
			<button
				aria-label={isStarred ? tStarRemove : tStarAdd}
				aria-pressed={isStarred}
				className={cn(
					'focus-visible:outline-cldt-green ml-1 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded text-lg transition-colors focus-visible:outline-2',
					isStarred
						? 'text-amber-400'
						: 'text-gray-300 hover:text-amber-400 dark:text-[var(--poi-star-inactive)] dark:hover:text-amber-400',
				)}
				title={isStarred ? tStarRemove : tStarAdd}
				type="button"
				onClick={onToggleStar}
			>
				<span aria-hidden>{isStarred ? '★' : '☆'}</span>
			</button>
			<span className="flex h-8 w-6 shrink-0 items-center justify-center self-center">
				<Checkbox
					aria-label={isSelected ? tExportDeselect : tExportSelect}
					checked={isSelected}
					title={isSelected ? tExportDeselect : tExportSelect}
					onCheckedChange={onToggleSelected}
				/>
			</span>
			<button
				aria-label={`${displayName} - ${tType}, ${distLabel}`}
				aria-selected={isActive}
				className="focus-visible:ring-cldt-green flex w-full flex-col items-start gap-0 rounded py-1.5 pr-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
				role="option"
				type="button"
				onClick={onPick}
			>
				<span className="font-medium text-gray-800 dark:text-[var(--text-primary)]">{displayName}</span>
				<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
					{tType} · {distLabel}
					{offTrailLabel && <> · {tOffTrailShort(offTrailLabel)}</>}
					{sort === 'gps' && gpsLabel && <> · {tFromYou(gpsLabel)}</>}
					{sort === 'ahead' && aheadLabel && <> · {aheadLabel}</>}
					{poi.water && tWater && (
						<>
							{' · '}
							<span className="inline-flex items-baseline gap-1">
								<span
									aria-hidden
									className="inline-block h-2 w-2 rounded-full"
									style={{ background: WATER_COLOR[poi.water.reliability] }}
								/>
								{tWater}
							</span>
						</>
					)}
				</span>
			</button>
		</div>
	);
});
