'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMap } from 'react-leaflet';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { MapControlModalShell } from '@/components/map/controls/MapControlModalShell';
import { useMapStore, type MapStoreState } from '@/lib/store';
import type { PendingSharedTrip } from '@/lib/store/types';
import { addInterval, totalCompletedKm, type CompletionInterval } from '@/lib/completion';
import { haversineDistanceM } from '@/lib/haversine';
import { flyToOrSetView } from '@/lib/map-view';
import { SHARED_WAYPOINT_DEDUPE_M } from '@/lib/share-url-constants';
import { formatDistance } from '@/lib/utils';

/**
 * Asks before trip data from an opened share link touches the local data:
 * view without importing (the default), add it to the local data, or replace
 * the kinds of data the link carries (backed up first, with an undo). Progress
 * is imported only when ticked. A waypoint link offers no replace: swapping
 * every waypoint for the one shared is never what it is for.
 */
export function ShareTripImportDialog(): React.ReactElement | null {
	const pending = useMapStore((s: MapStoreState) => s.pendingSharedTrip);
	// Mounted per pending link, so the options start fresh each time.
	return pending ? <ShareTripImportDialogContent pending={pending} /> : null;
}

function ShareTripImportDialogContent({ pending }: { pending: PendingSharedTrip }): React.ReactElement {
	const t = useTranslations('shareImport');
	const map = useMap();
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);
	const hasOwnPlan = useMapStore((s: MapStoreState) => s.stagePlan !== null);
	const [includeProgress, setIncludeProgress] = useState(false);
	const [replaceFailed, setReplaceFailed] = useState(false);
	const viewButtonRef = useRef<HTMLButtonElement>(null);
	const { data, focusWaypointId } = pending;

	const progressKm = useMemo(
		() =>
			totalCompletedKm(
				data.done.reduce<CompletionInterval[]>((acc, [startKm, endKm]) => addInterval(acc, startKm, endKm), []),
			),
		[data.done],
	);

	const summary = [
		data.stagePlan && t('summaryStages', { count: data.stagePlan.stages.length }),
		data.waypoints.length > 0 && t('summaryWaypoints', { count: data.waypoints.length }),
		data.journal.length > 0 && t('summaryJournal', { count: data.journal.length }),
		progressKm > 0 && t('summaryProgress', { distance: formatDistance(progressKm, units, distancePrecision) }),
		data.stars.length > 0 && t('summaryStars', { count: data.stars.length }),
	].filter((line): line is string => typeof line === 'string');

	const options = { includeProgress, sharedCollectionName: t('sharedCollectionName') };

	/** A waypoint link opens its waypoint once an import has added it, or the
	 *  own waypoint at the same place that the import kept instead. */
	const openFocusWaypoint = (): void => {
		if (!focusWaypointId) return;
		const store = useMapStore.getState();
		const shared = data.waypoints.find((wp) => wp.id === focusWaypointId);
		const target =
			store.userWaypoints.find((wp) => wp.id === focusWaypointId) ??
			(shared &&
				store.userWaypoints.find(
					(wp) => haversineDistanceM(wp.lat, wp.lng, shared.lat, shared.lng) <= SHARED_WAYPOINT_DEDUPE_M,
				));
		if (target) store.requestOpenWaypoint(target.id);
	};

	const handleView = (): void => {
		useMapStore.getState().setPendingSharedTrip(null);
		// A waypoint link still shows where its waypoint is, without adding it.
		const waypoint = focusWaypointId ? data.waypoints.find((wp) => wp.id === focusWaypointId) : undefined;
		if (waypoint) flyToOrSetView(map, [waypoint.lat, waypoint.lng], Math.max(map.getZoom(), 13));
	};

	const handleAdd = (): void => {
		useMapStore.getState().mergeTripData(data, options);
		openFocusWaypoint();
	};

	const handleReplace = (): void => {
		if (!useMapStore.getState().replaceTripData(data, options)) {
			setReplaceFailed(true);
			return;
		}
		openFocusWaypoint();
	};

	return (
		<MapControlModalShell
			open
			initialFocusRef={viewButtonRef}
			showCloseButton={false}
			title={t('title')}
			titleId="share-trip-import-title"
			onClose={handleView}
		>
			<p className="m-0 text-xs text-gray-600 dark:text-[var(--text-secondary)]">{t('body')}</p>
			<ul className="m-0 list-disc pl-5 text-xs text-gray-700 dark:text-[var(--text-primary)]">
				{summary.map((line) => (
					<li key={line}>{line}</li>
				))}
			</ul>
			{progressKm > 0 ? (
				<label className="flex cursor-pointer items-center gap-2 text-xs text-gray-700 dark:text-[var(--text-primary)]">
					<Checkbox checked={includeProgress} onCheckedChange={setIncludeProgress} />
					<span>{t('includeProgress')}</span>
				</label>
			) : null}
			{data.stagePlan && hasOwnPlan && !focusWaypointId ? (
				<p className="m-0 text-[0.625rem] leading-snug text-gray-500 dark:text-[var(--text-secondary)]">
					{t('addKeepsPlan')}
				</p>
			) : null}
			{focusWaypointId ? null : (
				<p className="m-0 text-[0.625rem] leading-snug text-gray-500 dark:text-[var(--text-secondary)]">
					{t('replaceNote')}
				</p>
			)}
			{replaceFailed ? (
				<p className="m-0 text-xs text-red-700 dark:text-red-400" role="alert">
					{t('replaceFailed')}
				</p>
			) : null}
			<div className="mt-1 flex flex-wrap justify-end gap-2">
				<Button ref={viewButtonRef} size="sm" variant="mapControlOutline" onClick={handleView}>
					{t('view')}
				</Button>
				<Button size="sm" variant="mapControlOutline" onClick={handleAdd}>
					{t('add')}
				</Button>
				{focusWaypointId ? null : (
					<Button size="sm" variant="primary" onClick={handleReplace}>
						{t('replace')}
					</Button>
				)}
			</div>
		</MapControlModalShell>
	);
}
