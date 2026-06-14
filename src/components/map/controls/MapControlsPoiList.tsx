'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import { useLocale, useTranslations } from 'next-intl';
import { IoLocationOutline } from 'react-icons/io5';
import { type GroupBase, type MultiValue } from 'react-select';
import { useMapStore, useStore, type MapStoreState, type StoreState, TrailDirection, UnitSystem } from '@/lib/store';
import { isDefaultStarredCollectionName } from '@/lib/store/types';
import {
	collectPoiTags,
	countPoisHiddenByReachabilityFilter,
	loadPoiTypeCounts,
	POI_TYPE_GROUPS,
	poiDisplayName,
	poiMatchesTagFilter,
	poiPassesReachabilityFilter,
	type Poi,
} from '@/lib/pois';
import { defaultEnabledPoiTypes, TRAIL_OFF_TRAIL_THRESHOLD_M } from '@/lib/config';
import {
	WATER_COLOR,
	WATER_RELIABILITY_OPTIONS,
	poiMatchesWaterReliabilityFilter,
	type WaterReliability,
} from '@/lib/water-intelligence';
import {
	AHEAD_HORIZON_OPTIONS,
	aheadCorridorSoboRange,
	formatAheadHorizon,
	poiAheadKm,
	resolveTrailAnchor,
} from '@/lib/poi-ahead-corridor';
import {
	usePoiListRows,
	usePopoverFocusTrap,
	useActiveStarredPoiIds,
	type ParsedDistance,
	type SortMode,
} from '@/hooks';
import { cn, formatDistance, formatOffTrail } from '@/lib/utils';
import { findNearestPointIndex } from '@/lib/distance-utils';
import { haversineDistanceM } from '@/lib/haversine';
import { buildGpxWaypointXml, downloadGpxFile, type GpxWaypoint } from '@/lib/gpx-export';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { MAP_CONTROL_INPUT, MAP_CONTROL_POPOVER } from './map-controls-constants';
import { MapControlMultiSelect, MapControlSelectColorDotLabel, MapControlSingleSelect } from './MapControlSelect';
import { MapControlInlineNameForm } from './MapControlInlineNameForm';
import { MapControlsButton } from './MapControlsButton';
import { MapControlsPoiDisclaimerModal } from './MapControlsPoiDisclaimerModal';
import { DistanceUnit } from '@/lib/types';

/** Window after which the POI disclaimer must be shown again (30 days). */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// formatJumpLabel intentionally bypasses the metric/imperial conversion
// in formatDistance (utils.ts): parseDistanceQuery returns values already
// in the user's active unit (km or mi), so no conversion is needed here.
function formatJumpLabel(distance: number, unit: DistanceUnit): string {
	const rounded = Math.round(distance * 10) / 10;
	return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)} ${unit}`;
}

interface PoiListRowProps {
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
const PoiListRow = React.memo(function PoiListRow({
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
	const displayKm = direction === 'SOBO' ? poi.trailKm : Math.max(0, totalKm - poi.trailKm);
	const distLabel = formatDistance(displayKm, units, distancePrecision);
	const offTrailLabel = poi.distanceFromTrailKm >= 0.5 ? formatOffTrail(poi.distanceFromTrailKm, units) : '';
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

interface MapControlsPoiListProps {
	containerRef: React.RefObject<HTMLDivElement | null>;
	isExpanded: boolean;
	onToggle: () => void;
	/** Must be a stable reference (wrapped in useCallback at the call site), so
	 *  the pickHandlers useMemo inside does not rebuild on every parent render. */
	onClose: () => void;
}

/**
 * Scrollable list of all currently visible POIs. "Visible" matches the same
 * filter PoiMarkers uses: master layer toggle + per-type enabled set. Rows
 * are sortable by trail km (default, direction-aware), name (locale-folded),
 * or distance from the trail.
 *
 * Clicking a row flies the map to the POI at a marker-friendly zoom (past
 * the cluster threshold) so the corresponding marker is materialized and
 * its popup can be opened by the user from the map.
 */
export function MapControlsPoiList({
	containerRef,
	isExpanded,
	onToggle,
	onClose,
}: MapControlsPoiListProps): React.ReactElement {
	const map = useMap();
	const t = useTranslations('pois');
	const locale = useLocale();
	const poisFile = useMapStore((s: MapStoreState) => s.poisFile);
	const poisLayerEnabled = useMapStore((s: MapStoreState) => s.poisLayerEnabled);
	const setPoisLayerEnabled = useMapStore((s: MapStoreState) => s.setPoisLayerEnabled);
	const poiDisclaimerDismissedAt = useMapStore((s: MapStoreState) => s.poiDisclaimerDismissedAt);
	const setPoiDisclaimerDismissedAt = useMapStore((s: MapStoreState) => s.setPoiDisclaimerDismissedAt);
	const poiFiltersUserModified = useMapStore((s: MapStoreState) => s.poiFiltersUserModified);
	const resetPoiFiltersToDefaults = useMapStore((s: MapStoreState) => s.resetPoiFiltersToDefaults);
	const [disclaimerOpen, setDisclaimerOpen] = useState(false);

	// Re-seed defaults only when the user has never touched the filters. Runs
	// from both disclaimer paths (Confirm + DismissFor30Days) so an in-memory
	// clear by some other code path can't leave the layer enabled with an
	// empty filter on the very first opt-in.
	const seedDefaultFiltersIfPristine = useCallback((): void => {
		if (!poiFiltersUserModified) resetPoiFiltersToDefaults();
	}, [poiFiltersUserModified, resetPoiFiltersToDefaults]);

	const handlePoisLayerToggle = useCallback(
		(checked: boolean): void => {
			if (!checked) {
				setPoisLayerEnabled(false);
				return;
			}
			const stillDismissed =
				poiDisclaimerDismissedAt !== null && Date.now() - poiDisclaimerDismissedAt < THIRTY_DAYS_MS;
			if (stillDismissed) {
				setPoisLayerEnabled(true);
				return;
			}
			setDisclaimerOpen(true);
		},
		[poiDisclaimerDismissedAt, setPoisLayerEnabled],
	);
	const enabledPoiTypes = useMapStore((s: MapStoreState) => s.enabledPoiTypes);
	const setEnabledPoiTypes = useMapStore((s: MapStoreState) => s.setEnabledPoiTypes);
	const enabledPoiTags = useMapStore((s: MapStoreState) => s.enabledPoiTags);
	const includeRemotePois = useMapStore((s: MapStoreState) => s.includeRemotePois);
	const setIncludeRemotePois = useMapStore((s: MapStoreState) => s.setIncludeRemotePois);
	const togglePoiTag = useMapStore((s: MapStoreState) => s.togglePoiTag);
	const clearPoiTags = useMapStore((s: MapStoreState) => s.clearPoiTags);
	const direction = useMapStore((s: MapStoreState) => s.direction);
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);
	const userLocation = useMapStore((s: MapStoreState) => s.userLocation);
	const permissionStatus = useMapStore((s: MapStoreState) => s.permissionStatus);
	const hasGps = !!userLocation && permissionStatus === 'granted';
	const starredPoiCollections = useMapStore((s: MapStoreState) => s.starredPoiCollections);
	const activeStarredCollectionId = useMapStore((s: MapStoreState) => s.activeStarredCollectionId);
	const setActiveStarredCollectionId = useMapStore((s: MapStoreState) => s.setActiveStarredCollectionId);
	const createStarredPoiCollection = useMapStore((s: MapStoreState) => s.createStarredPoiCollection);
	const renameStarredPoiCollection = useMapStore((s: MapStoreState) => s.renameStarredPoiCollection);
	const deleteStarredPoiCollection = useMapStore((s: MapStoreState) => s.deleteStarredPoiCollection);
	const poiFilterPresets = useMapStore((s: MapStoreState) => s.poiFilterPresets);
	const savePoiFilterPreset = useMapStore((s: MapStoreState) => s.savePoiFilterPreset);
	const applyPoiFilterPreset = useMapStore((s: MapStoreState) => s.applyPoiFilterPreset);
	const deletePoiFilterPreset = useMapStore((s: MapStoreState) => s.deletePoiFilterPreset);
	const renamePoiFilterPreset = useMapStore((s: MapStoreState) => s.renamePoiFilterPreset);
	const activeStarredPoiIds = useActiveStarredPoiIds();
	const toggleStarredPoi = useMapStore((s: MapStoreState) => s.toggleStarredPoi);
	const clearStarredPois = useMapStore((s: MapStoreState) => s.clearStarredPois);
	const requestOpenPoi = useMapStore((s: MapStoreState) => s.requestOpenPoi);
	const aheadHorizonKm = useMapStore((s: MapStoreState) => s.aheadHorizonKm);
	const setAheadHorizonKm = useMapStore((s: MapStoreState) => s.setAheadHorizonKm);
	const pendingPoiListSort = useMapStore((s: MapStoreState) => s.pendingPoiListSort);
	const clearPendingPoiListSort = useMapStore((s: MapStoreState) => s.clearPendingPoiListSort);
	const rulerRange = useMapStore((s: MapStoreState) => s.rulerRange);
	const closestPoint = useStore((s: StoreState) => s.closestPoint);
	const trailMetadata = useStore((s: StoreState) => s.trailMetadata);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);
	const highlightTrailPosition = useStore((s: StoreState) => s.highlightTrailPosition);
	const setTooltipPinnedFromShare = useStore((s: StoreState) => s.setTooltipPinnedFromShare);
	const popoverRef = usePopoverFocusTrap(isExpanded);
	const searchInputRef = useRef<HTMLInputElement | null>(null);

	const [sort, setSort] = useState<SortMode>('trail');
	const [query, setQuery] = useState('');
	/** Debounced query feeds the O(N) search filter to avoid scanning 8k+ POIs
	 *  on every keystroke. The input stays responsive on `query` itself. */
	const [debouncedQuery, setDebouncedQuery] = useState('');
	useEffect(() => {
		const id = window.setTimeout(() => setDebouncedQuery(query), 150);
		return () => window.clearTimeout(id);
	}, [query]);
	/** When true and sort === 'trail', rows are bucketed into 50 km decades
	 *  with a header per bucket. Useful for 8k+ POI datasets where a flat
	 *  list is too long to scan. */
	const [groupByDecade, setGroupByDecade] = useState(false);
	/** Inline name input when saving a filter preset or creating a star collection. */
	const [presetNameInput, setPresetNameInput] = useState('');
	const [savingFilterPreset, setSavingFilterPreset] = useState(false);
	const [collectionNameInput, setCollectionNameInput] = useState('');
	const [creatingStarCollection, setCreatingStarCollection] = useState(false);
	const [renamingPresetId, setRenamingPresetId] = useState<string | null>(null);
	const [renamePresetInput, setRenamePresetInput] = useState('');
	const [renamingCollectionId, setRenamingCollectionId] = useState<string | null>(null);
	const [renameCollectionInput, setRenameCollectionInput] = useState('');
	/** When non-empty, only water POIs in the selected reliability classes appear. */
	const [enabledWaterReliability, setEnabledWaterReliability] = useState<ReadonlySet<WaterReliability>>(
		() => new Set(),
	);
	/** POI ids selected for GPX export. Lives only while the panel is open;
	 *  reset on close so re-opening starts with a fresh selection. */
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	/** Keyboard cursor over the list rows. `null` means "no row focused yet".
	 *  ArrowDown promotes to 0; Enter flies to the active row; S toggles its
	 *  selection. Reset when the row set changes so the highlight never lands
	 *  on a stale entry. */
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
	const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

	const totalKm = useMemo((): number => {
		if (trailMetadata?.totalDistance) return trailMetadata.totalDistance;
		if (!poisFile?.pois?.length) return 0;
		return poisFile.pois.reduce((m, p) => (p.trailKm > m ? p.trailKm : m), 0);
	}, [poisFile, trailMetadata]);

	const trailAnchor = useMemo(
		() => resolveTrailAnchor(closestPoint, rulerRange, TRAIL_OFF_TRAIL_THRESHOLD_M),
		[closestPoint, rulerRange],
	);
	const anchorSoboKm = trailAnchor?.soboKm ?? null;

	/** Snapped GPS coordinates: rounded to ~0.001 deg (~100 m), so the
	 *  O(N) haversine loop below only re-runs when the user has moved
	 *  meaningfully rather than on every raw GPS tick. */
	const snappedLat = userLocation ? Math.round(userLocation.lat * 1000) / 1000 : null;
	const snappedLng = userLocation ? Math.round(userLocation.lng * 1000) / 1000 : null;

	/** Per-POI distance from the user's GPS fix, in metres. Empty when GPS is
	 *  not granted - the gps sort falls back to trail order so the panel still
	 *  renders something sensible if the fix is lost mid-session. Only the
	 *  currently visible (type/tag-filtered) subset is computed - the sorted
	 *  list never shows a POI outside that filter, so haversining the
	 *  remaining ~7k+ rows would be wasted work. */
	const gpsDistanceById = useMemo((): Map<string, number> => {
		const out = new Map<string, number>();
		if (!hasGps || snappedLat === null || snappedLng === null || !poisFile?.pois?.length) return out;
		const filterTypes = enabledPoiTypes;
		const filterTags = enabledPoiTags;
		for (const p of poisFile.pois) {
			if (!filterTypes.has(p.type)) continue;
			if (!poiMatchesTagFilter(p, filterTags)) continue;
			if (!poiMatchesWaterReliabilityFilter(p, enabledWaterReliability)) continue;
			if (!poiPassesReachabilityFilter(p, includeRemotePois)) continue;
			out.set(p.id, haversineDistanceM(snappedLat, snappedLng, p.lat, p.lng));
		}
		return out;
	}, [
		hasGps,
		snappedLat,
		snappedLng,
		poisFile,
		enabledPoiTypes,
		enabledPoiTags,
		enabledWaterReliability,
		includeRemotePois,
	]);

	/** All tags present in the dataset, sorted alphabetically. Empty list
	 *  hides the tag-chip row entirely - keeps the panel clean for datasets
	 *  that don't carry tags yet. */
	const allTags = useMemo((): string[] => (poisFile?.pois?.length ? collectPoiTags(poisFile.pois) : []), [poisFile]);

	const hiddenByReachabilityCount = useMemo(
		(): number => countPoisHiddenByReachabilityFilter(poisFile?.pois ?? []),
		[poisFile],
	);

	/** Grouped options for the react-select POI-type multi-select. Rebuilds
	 *  only on locale change since labels go through next-intl. */
	const typeOptions = useMemo(
		(): GroupBase<{ value: string; label: string }>[] =>
			POI_TYPE_GROUPS.map((g) => ({
				label: t(`group.${g.id}`),
				options: g.types.map((type) => ({ value: type, label: t(`type.${type}`) })),
			})),
		[t],
	);

	/** Full-dataset count per POI type, from the split manifest. Drives the
	 *  "(123)" suffix on menu options; null (manifest unavailable) hides the
	 *  counts rather than showing zeros for never-loaded types. */
	const [typeCounts, setTypeCounts] = useState<Record<string, number> | null>(null);
	useEffect(() => {
		let cancelled = false;
		void loadPoiTypeCounts().then((counts) => {
			if (!cancelled && counts) setTypeCounts(counts);
		});
		return () => {
			cancelled = true;
		};
	}, []);
	const selectedTypeOptions = useMemo(
		() => typeOptions.flatMap((g) => g.options).filter((o) => enabledPoiTypes.has(o.value)),
		[typeOptions, enabledPoiTypes],
	);

	const waterReliabilityOptions = useMemo(
		(): { value: WaterReliability; label: string }[] =>
			WATER_RELIABILITY_OPTIONS.map((rel) => ({ value: rel, label: t(`water.${rel}`) })),
		[t],
	);
	const selectedWaterReliabilityOptions = useMemo(
		() => waterReliabilityOptions.filter((o) => enabledWaterReliability.has(o.value)),
		[waterReliabilityOptions, enabledWaterReliability],
	);

	const sortOptions = useMemo((): { value: SortMode; label: string }[] => {
		const base: { value: SortMode; label: string }[] = [
			{ value: 'trail', label: t('sortByTrail') },
			{ value: 'name', label: t('sortByName') },
			{ value: 'offTrail', label: t('sortByOffTrail') },
		];
		if (trailAnchor) {
			base.push({
				value: 'ahead',
				label: t('sortByAhead', {
					distance: formatAheadHorizon(aheadHorizonKm, units, distancePrecision),
				}),
			});
		}
		if (hasGps) base.push({ value: 'gps', label: t('sortByGps') });
		return base;
	}, [t, hasGps, trailAnchor, aheadHorizonKm, units, distancePrecision]);
	const selectedSortOption = useMemo(
		() => sortOptions.find((o) => o.value === sort) ?? sortOptions[0],
		[sortOptions, sort],
	);

	const filterPresetOptions = useMemo(
		(): { value: string; label: string }[] => poiFilterPresets.map((p) => ({ value: p.id, label: p.name })),
		[poiFilterPresets],
	);

	const displayStarCollectionName = useCallback(
		(name: string): string => (isDefaultStarredCollectionName(name) ? t('starCollectionDefaultName') : name),
		[t],
	);

	const starCollectionOptions = useMemo(
		(): { value: string; label: string }[] =>
			starredPoiCollections.map((c) => ({
				value: c.id,
				label: `${displayStarCollectionName(c.name)} (${c.poiIds.length})`,
			})),
		[starredPoiCollections, displayStarCollectionName],
	);
	const selectedStarCollectionOption = useMemo(
		() => starCollectionOptions.find((o) => o.value === activeStarredCollectionId) ?? null,
		[starCollectionOptions, activeStarredCollectionId],
	);

	const handleSaveFilterPreset = useCallback((): void => {
		const id = savePoiFilterPreset(presetNameInput);
		if (id) {
			setPresetNameInput('');
			setSavingFilterPreset(false);
		}
	}, [presetNameInput, savePoiFilterPreset]);

	const handleCreateStarCollection = useCallback((): void => {
		const id = createStarredPoiCollection(collectionNameInput);
		if (id) {
			setCollectionNameInput('');
			setCreatingStarCollection(false);
		}
	}, [collectionNameInput, createStarredPoiCollection]);

	const handleRenameFilterPreset = useCallback((): void => {
		if (!renamingPresetId) return;
		const trimmed = renamePresetInput.trim();
		if (!trimmed) return;
		renamePoiFilterPreset(renamingPresetId, trimmed);
		setRenamingPresetId(null);
		setRenamePresetInput('');
	}, [renamingPresetId, renamePresetInput, renamePoiFilterPreset]);

	const handleRenameStarCollection = useCallback((): void => {
		if (!renamingCollectionId) return;
		const trimmed = renameCollectionInput.trim();
		if (!trimmed) return;
		renameStarredPoiCollection(renamingCollectionId, trimmed);
		setRenamingCollectionId(null);
		setRenameCollectionInput('');
	}, [renamingCollectionId, renameCollectionInput, renameStarredPoiCollection]);

	/** Pre-compute display names keyed by POI id. Scoped to [poisFile, locale],
	 *  so it only rebuilds when the dataset or language changes - not on every
	 *  sort/filter/cursor change. Shared by both the sort comparator and renderRow,
	 *  so name lookups are O(1) Map.get calls rather than O(N) string picks per render. */
	const displayNameById = useMemo(
		(): Map<string, string> => new Map((poisFile?.pois ?? []).map((p) => [p.id, poiDisplayName(p, locale)])),
		[poisFile, locale],
	);

	/** Filtered + sorted rows, decade-bucketed view, and the jump-to parse of
	 *  the search box, all owned by the extracted hook so this component only
	 *  has to wire presentation + events. */
	const { parsedDistance, rows, groupedItems } = usePoiListRows({
		pois: poisFile?.pois ?? null,
		enabledPoiTypes,
		enabledPoiTags,
		enabledWaterReliability,
		includeRemotePois,
		debouncedQuery,
		units,
		direction,
		trailTotalKm: trailMetadata?.totalDistance ?? null,
		totalKm,
		sort,
		locale,
		hasGps,
		gpsDistanceById,
		anchorSoboKm,
		aheadHorizonKm,
		displayNameById,
		groupByDecade,
	});

	const aheadKmById = useMemo((): Map<string, number> => {
		const out = new Map<string, number>();
		if (sort !== 'ahead' || anchorSoboKm === null) return out;
		for (const p of rows) {
			const km = poiAheadKm(p.trailKm, anchorSoboKm, direction);
			if (km !== null) out.set(p.id, km);
		}
		return out;
	}, [sort, anchorSoboKm, direction, rows]);

	const aheadSummary = useMemo((): string | null => {
		if (sort !== 'ahead' || anchorSoboKm === null) return null;
		const range = aheadCorridorSoboRange(anchorSoboKm, aheadHorizonKm, direction, totalKm);
		const fromTrailKm = direction === 'SOBO' ? range.from : totalKm - range.to;
		const toTrailKm = direction === 'SOBO' ? range.to : totalKm - range.from;
		const scale = units === 'imperial' ? 0.621371 : 1;
		return t('aheadSummary', {
			count: rows.length,
			from: (fromTrailKm * scale).toFixed(0),
			to: (toTrailKm * scale).toFixed(0),
			unit: units === 'imperial' ? 'mi' : 'km',
		});
	}, [sort, anchorSoboKm, aheadHorizonKm, direction, totalKm, rows.length, units, t]);

	// Deep-link from Up next chip or stage planner preview.
	useEffect(() => {
		if (!isExpanded || pendingPoiListSort !== 'ahead') return;
		queueMicrotask(() => {
			setSort('ahead');
			clearPendingPoiListSort();
		});
	}, [isExpanded, pendingPoiListSort, clearPendingPoiListSort]);

	// If ahead sort is active but the anchor disappears, fall back to trail order.
	useEffect(() => {
		if (sort !== 'ahead' || trailAnchor) return;
		queueMicrotask(() => setSort('trail'));
	}, [sort, trailAnchor]);

	// Auto-promote to "Near me" the first time GPS becomes available and the
	// user hasn't already manually picked a different sort. Manual picks are
	// preserved (we only switch out of the default `trail` mode). Deferred to
	// a microtask, so the lint rule against synchronous setState-in-effect is
	// satisfied; the visual outcome is identical (one extra microtask).
	// On the first GPS lock, switch from the default 'trail' sort to 'gps'. The ref
	// guard ensures this only fires once; later user picks (including
	// returning to 'trail') are preserved.
	const gpsAutoSwitchedRef = useRef(false);
	useEffect(() => {
		if (hasGps && !gpsAutoSwitchedRef.current && sort === 'trail') {
			gpsAutoSwitchedRef.current = true;
			queueMicrotask(() => setSort('gps'));
		}
	}, [hasGps, sort]);

	useEffect(() => {
		if (isExpanded) {
			// Focus the search input on open so the user can type immediately.
			queueMicrotask(() => searchInputRef.current?.focus());
		} else {
			// Drop transient state on close so reopening starts clean.
			queueMicrotask(() => {
				setSelected(new Set());
				setQuery('');
			});
		}
	}, [isExpanded]);

	// Stable identity - setSelected (from useState) never changes, so this
	// callback has effectively empty deps and won't trigger memo busting on
	// unrelated renders.
	const toggleSelected = useCallback((id: string): void => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const showWaterReliabilityFilter = enabledPoiTypes.has('water');

	// Stable translation helpers - only re-created when `t` changes (i.e. locale change).
	const tOffTrailShort = useCallback((distance: string) => t('offTrailShort', { distance }), [t]);
	const tFromYou = useCallback((distance: string) => t('fromYou', { distance }), [t]);
	const tAheadOfYou = useCallback((distance: string) => t('aheadOfYou', { distance }), [t]);

	const handleExportSelection = (): void => {
		if (selected.size === 0) return;
		// Preserve the current sort order so the GPX file matches what the user
		// sees in the panel (helps when they import into an app that respects
		// waypoint order).
		const picked = rows.filter((p) => selected.has(p.id));
		if (picked.length === 0) return;
		const waypoints: GpxWaypoint[] = picked.map((p) => {
			const name = poiDisplayName(p, locale);
			const typeLabel = t(`type.${p.type}`, { default: p.type });
			return {
				lat: p.lat,
				lng: p.lng,
				name,
				type: typeLabel,
				elevation: typeof p.elevationM === 'number' ? p.elevationM : undefined,
				description: p.note_en || p.note_hr || undefined,
				url: p.url || undefined,
			};
		});
		const xml = buildGpxWaypointXml(waypoints, t('listTitle'));
		downloadGpxFile(xml, 'cldt-pois.gpx');
	};

	const handlePick = useCallback(
		(poi: Poi): void => {
			// Route through the store so PoiMarkers does the same fly + open-popup
			// dance the stage planner's POI list and the share-URL deep-link
			// already use - the marker materialises past the cluster threshold,
			// then its popup opens automatically.
			requestOpenPoi(poi.id);
			onClose();
		},
		[requestOpenPoi, onClose],
	);

	const handleJump = useCallback(
		(parsed: ParsedDistance): void => {
			if (!enhancedTrailPoints?.length) return;
			const targetM = parsed.soboKm * 1000;
			const idx = findNearestPointIndex(enhancedTrailPoints, targetM);
			const closest = enhancedTrailPoints[idx];
			const zoom = Math.max(map.getZoom(), 12);
			map.flyTo([closest.lat, closest.lng], zoom, { duration: 0.5 });
			highlightTrailPosition?.({ distance: closest.distanceFromStart });
			setTooltipPinnedFromShare?.(true);
			onClose();
		},
		[enhancedTrailPoints, map, highlightTrailPosition, setTooltipPinnedFromShare, onClose],
	);

	const jumpLabel = parsedDistance
		? t('jumpTo', { distance: formatJumpLabel(parsedDistance.value, parsedDistance.unit) })
		: null;

	const groupByDecadeLabel = t('groupByDecade', {
		distance: units === 'imperial' ? 30 : 50,
		unit: units === 'imperial' ? 'mi' : 'km',
	});

	const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
		if (e.key === 'Escape') {
			onClose();
			return;
		}
		if (rows.length === 0) return;
		// Ignore keystrokes that originate from form controls (search input,
		// sort select, type filter input). Otherwise, typing in the search
		// field would also scroll the list cursor.
		const target = e.target as HTMLElement | null;
		if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT') return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setActiveIndex((idx) => (idx === null ? 0 : Math.min(idx + 1, rows.length - 1)));
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			setActiveIndex((idx) => (idx === null ? 0 : Math.max(idx - 1, 0)));
		} else if (e.key === 'Enter' && activeIndex !== null) {
			e.preventDefault();
			const poi = rows[activeIndex];
			if (poi) handlePick(poi);
		} else if ((e.key === 's' || e.key === 'S') && activeIndex !== null) {
			e.preventDefault();
			const poi = rows[activeIndex];
			if (poi) toggleSelected(poi.id);
		}
	};

	// Reset the cursor whenever the underlying row set changes (sort, filter,
	// debouncedQuery, tag filter, GPS distance recompute - all of which feed
	// into `rows` via usePoiListRows) so we never highlight a stale index.
	// `rows` identity is the single source-of-truth here; no need to list
	// the upstream triggers in this effect.
	useEffect(() => {
		queueMicrotask(() => setActiveIndex(null));
	}, [rows]);

	useEffect(() => {
		if (activeIndex === null) return;
		rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
	}, [activeIndex]);

	/** Pre-materialized handler arrays: one stable closure per row, keyed on
	 *  [rows, handlePick/toggleStarredPoi/toggleSelected]. Identities only change
	 *  when the row set or a dependency changes - cursor movement and selection
	 *  toggles do NOT rebuild these, so React.memo can correctly skip unchanged
	 *  rows. Built in a single rows.map() pass to avoid 3x the iteration. */
	const rowHandlers = useMemo(() => {
		const pick: (() => void)[] = new Array(rows.length);
		const select: (() => void)[] = new Array(rows.length);
		const star: (() => void)[] = new Array(rows.length);
		for (let i = 0; i < rows.length; i++) {
			const poi = rows[i];
			pick[i] = () => handlePick(poi);
			select[i] = () => toggleSelected(poi.id);
			star[i] = () => toggleStarredPoi(poi.id);
		}
		return { pick, select, star };
	}, [rows, handlePick, toggleSelected, toggleStarredPoi]);
	const pickHandlers = rowHandlers.pick;
	const selectHandlers = rowHandlers.select;
	const starHandlers = rowHandlers.star;

	/** Pre-computed per-row aria/title labels. Computing the four name-
	 *  interpolated `t()` strings inside renderRow allocates ~32k strings per
	 *  parent render at 8k rows; doing it once per row-set change here drops
	 *  that to ~32k once instead of per pan/cursor-move. */
	const rowLabels = useMemo(() => {
		const starAdd: string[] = new Array(rows.length);
		const starRemove: string[] = new Array(rows.length);
		const exportSelect: string[] = new Array(rows.length);
		const exportDeselect: string[] = new Array(rows.length);
		const typeLabel: string[] = new Array(rows.length);
		const waterLabel: string[] = new Array(rows.length);
		for (let i = 0; i < rows.length; i++) {
			const poi = rows[i];
			const name = displayNameById.get(poi.id) ?? poiDisplayName(poi, locale);
			starAdd[i] = t('starAdd', { name });
			starRemove[i] = t('starRemove', { name });
			exportSelect[i] = t('exportSelect', { name });
			exportDeselect[i] = t('exportDeselect', { name });
			typeLabel[i] = t(`type.${poi.type}`, { default: poi.type });
			waterLabel[i] = poi.water ? t(`water.${poi.water.reliability}`) : '';
		}
		return { starAdd, starRemove, exportSelect, exportDeselect, typeLabel, waterLabel };
	}, [rows, displayNameById, locale, t]);

	const renderRow = useCallback(
		(poi: Poi, i: number): React.ReactElement => {
			const name = displayNameById.get(poi.id) ?? poiDisplayName(poi, locale);
			return (
				<PoiListRow
					aheadKm={aheadKmById.get(poi.id)}
					direction={direction}
					displayName={name}
					distancePrecision={distancePrecision}
					gpsDistanceM={gpsDistanceById.get(poi.id)}
					hasGps={hasGps}
					index={i}
					isActive={activeIndex === i}
					isSelected={selected.has(poi.id)}
					isStarred={activeStarredPoiIds.has(poi.id)}
					key={poi.id}
					poi={poi}
					rowRefsRef={rowRefs}
					sort={sort}
					tAheadOfYou={tAheadOfYou}
					tExportDeselect={rowLabels.exportDeselect[i]}
					tExportSelect={rowLabels.exportSelect[i]}
					tFromYou={tFromYou}
					tOffTrailShort={tOffTrailShort}
					tStarAdd={rowLabels.starAdd[i]}
					tStarRemove={rowLabels.starRemove[i]}
					tType={rowLabels.typeLabel[i]}
					tWater={rowLabels.waterLabel[i]}
					totalKm={totalKm}
					units={units}
					onPick={pickHandlers[i]}
					onToggleSelected={selectHandlers[i]}
					onToggleStar={starHandlers[i]}
				/>
			);
		},
		[
			activeIndex,
			aheadKmById,
			direction,
			displayNameById,
			distancePrecision,
			gpsDistanceById,
			hasGps,
			locale,
			pickHandlers,
			rowLabels,
			rowRefs,
			selectHandlers,
			selected,
			sort,
			starHandlers,
			activeStarredPoiIds,
			tAheadOfYou,
			tFromYou,
			tOffTrailShort,
			totalKm,
			units,
		],
	);

	const popoverContent = (
		<div
			aria-labelledby="poi-list-title"
			aria-modal="true"
			className={cn(
				MAP_CONTROL_POPOVER,
				'z-modal fixed top-2 right-16 flex max-h-[calc(100dvh-4rem)] w-80 flex-col gap-2',
			)}
			ref={popoverRef}
			role="dialog"
			onKeyDown={handleKeyDown}
			onMouseDown={(e) => e.stopPropagation()}
			onTouchStart={(e) => e.stopPropagation()}
		>
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-sm font-medium text-gray-700 dark:text-[var(--text-primary)]" id="poi-list-title">
					{t('listTitle')}
				</h3>
				<label
					className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-600 dark:text-[var(--text-secondary)]"
					title={t('layerToggleShort')}
				>
					<Checkbox checked={poisLayerEnabled} onCheckedChange={handlePoisLayerToggle} />
					<span>{t('layerToggleShort')}</span>
				</label>
			</div>

			<input
				aria-label={t('searchAriaLabel')}
				className={cn(MAP_CONTROL_INPUT, 'w-full')}
				placeholder={t('searchPlaceholderUnified')}
				ref={searchInputRef}
				type="search"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
			/>

			{parsedDistance && jumpLabel && (
				<button
					className="border-cldt-blue/30 bg-cldt-blue/5 hover:bg-cldt-blue/10 focus-visible:bg-cldt-blue/10 dark:bg-cldt-blue/15 focus-visible:ring-cldt-green flex w-full flex-col items-start gap-0 rounded border px-2 py-1.5 text-left text-sm focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
					type="button"
					onClick={() => handleJump(parsedDistance)}
				>
					<span className="text-cldt-blue font-medium dark:text-[var(--text-primary)]">{jumpLabel}</span>
					{rows.length > 0 && (
						<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
							{t('nearbyHint', { count: rows.length })}
						</span>
					)}
				</button>
			)}

			<MapControlMultiSelect<{ value: string; label: string }>
				aria-label={t('typeFilterPlaceholder')}
				formatOptionLabel={(option, meta) =>
					meta.context === 'menu' && typeCounts ? (
						<span>
							{option.label}{' '}
							<span className="text-gray-400 tabular-nums dark:text-[var(--text-secondary)]">
								({typeCounts[option.value] ?? 0})
							</span>
						</span>
					) : (
						option.label
					)
				}
				// Counts only in the open menu (context 'menu'), so the selected
				// chips stay compact. Falls back to the plain label while the
				// manifest is loading or unavailable.
				noOptionsMessage={() => t('typeFilterNoMatches')}
				options={typeOptions}
				placeholder={t('typeFilterPlaceholder')}
				value={selectedTypeOptions}
				onChange={(val: MultiValue<{ value: string; label: string }>) =>
					setEnabledPoiTypes(new Set(val.map((o) => o.value)))
				}
			/>

			<div className="flex flex-col gap-1">
				<div className="flex items-center justify-between text-[10px] tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
					<span>{t('filterPresetsHeading')}</span>
					{!savingFilterPreset && (
						<button
							className="text-cldt-blue focus-visible:ring-cldt-green rounded hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
							type="button"
							onClick={() => setSavingFilterPreset(true)}
						>
							{t('filterPresetsSave')}
						</button>
					)}
				</div>
				{filterPresetOptions.length > 0 && (
					<MapControlSingleSelect<{ value: string; label: string }>
						aria-label={t('filterPresetsApply')}
						options={filterPresetOptions}
						placeholder={t('filterPresetsApply')}
						value={null}
						onChange={(val) => {
							if (val) applyPoiFilterPreset(val.value);
						}}
					/>
				)}
				{poiFilterPresets.map((preset) =>
					renamingPresetId === preset.id ? (
						<MapControlInlineNameForm
							ariaLabel={t('filterPresetsNamePlaceholder')}
							cancelLabel={t('filterPresetsCancel')}
							confirmLabel={t('filterPresetsConfirm')}
							key={preset.id}
							placeholder={t('filterPresetsNamePlaceholder')}
							value={renamePresetInput}
							onCancel={() => {
								setRenamingPresetId(null);
								setRenamePresetInput('');
							}}
							onChange={setRenamePresetInput}
							onConfirm={handleRenameFilterPreset}
						/>
					) : (
						<div className="flex items-center justify-between gap-1 text-xs" key={preset.id}>
							<button
								className="text-cldt-blue focus-visible:ring-cldt-green truncate text-left hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
								type="button"
								onClick={() => applyPoiFilterPreset(preset.id)}
							>
								{preset.name}
							</button>
							<div className="flex shrink-0 items-center gap-0.5">
								<button
									aria-label={t('filterPresetsRename', { name: preset.name })}
									className="text-cldt-blue focus-visible:ring-cldt-green rounded px-1 hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
									type="button"
									onClick={() => {
										setRenamingPresetId(preset.id);
										setRenamePresetInput(preset.name);
									}}
								>
									✎
								</button>
								<button
									aria-label={t('filterPresetsDelete', { name: preset.name })}
									className="focus-visible:ring-cldt-green rounded px-1 text-gray-400 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none dark:text-[var(--text-secondary)] dark:hover:text-red-400"
									type="button"
									onClick={() => deletePoiFilterPreset(preset.id)}
								>
									×
								</button>
							</div>
						</div>
					),
				)}
				{savingFilterPreset && (
					<MapControlInlineNameForm
						ariaLabel={t('filterPresetsNamePlaceholder')}
						cancelLabel={t('filterPresetsCancel')}
						confirmLabel={t('filterPresetsConfirm')}
						placeholder={t('filterPresetsNamePlaceholder')}
						value={presetNameInput}
						onCancel={() => {
							setSavingFilterPreset(false);
							setPresetNameInput('');
						}}
						onChange={setPresetNameInput}
						onConfirm={handleSaveFilterPreset}
					/>
				)}
			</div>

			{hiddenByReachabilityCount > 0 && (
				<label className="flex cursor-pointer items-start gap-2">
					<Checkbox checked={includeRemotePois} onCheckedChange={setIncludeRemotePois} />
					<div className="flex flex-col gap-0.5">
						<span className="text-xs text-gray-700 dark:text-[var(--text-primary)]">{t('includeRemotePoisLabel')}</span>
						<span className="text-[10px] text-gray-500 dark:text-[var(--text-secondary)]">
							{t('includeRemotePoisHint')}
						</span>
					</div>
				</label>
			)}

			<div className="flex items-center gap-2">
				<div className="flex-1">
					<MapControlSingleSelect<{ value: SortMode; label: string }>
						aria-label={t('sortLabel')}
						options={sortOptions}
						placeholder={t('sortLabel')}
						value={selectedSortOption}
						onChange={(val) => {
							if (val) setSort(val.value);
						}}
					/>
				</div>
			</div>

			{showWaterReliabilityFilter && (
				<MapControlMultiSelect<{ value: WaterReliability; label: string }>
					aria-label={t('waterReliabilityFilterHeading')}
					formatOptionLabel={(option) => (
						<MapControlSelectColorDotLabel color={WATER_COLOR[option.value]} label={option.label} />
					)}
					isSearchable={false}
					options={waterReliabilityOptions}
					placeholder={t('waterReliabilityFilterPlaceholder')}
					value={selectedWaterReliabilityOptions}
					onChange={(val: MultiValue<{ value: WaterReliability; label: string }>) =>
						setEnabledWaterReliability(new Set((val ?? []).map((o) => o.value)))
					}
				/>
			)}

			{showWaterReliabilityFilter && enabledWaterReliability.size === 0 && (
				<p className="m-0 text-[10px] text-gray-500 dark:text-[var(--text-secondary)]">
					{t('waterReliabilityFilterHint')}
				</p>
			)}

			{sort === 'ahead' && (
				<div className="flex flex-wrap items-center gap-1">
					<span className="text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
						{t('aheadHorizonLabel')}
					</span>
					{AHEAD_HORIZON_OPTIONS.map((km) => (
						<button
							className={cn(
								'focus-visible:ring-cldt-green min-h-[28px] rounded-full border px-2 py-0.5 text-[10px] font-medium tabular-nums focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
								aheadHorizonKm === km
									? 'border-cldt-blue bg-cldt-blue text-[var(--marker-on-color)]'
									: 'hover:border-cldt-blue border-gray-300 text-gray-600 dark:border-[var(--border-color)] dark:text-[var(--text-secondary)]',
							)}
							key={km}
							type="button"
							onClick={() => setAheadHorizonKm(km)}
						>
							{formatAheadHorizon(km, units, distancePrecision)}
						</button>
					))}
				</div>
			)}

			{sort === 'ahead' && !trailAnchor ? (
				<p className="text-xs text-amber-700 italic dark:text-amber-300">{t('aheadNeedsAnchor')}</p>
			) : aheadSummary ? (
				<p className="text-xs text-gray-500 italic dark:text-[var(--text-secondary)]">{aheadSummary}</p>
			) : (
				<p className="text-xs text-gray-500 italic dark:text-[var(--text-secondary)]">
					{t('listCount', { count: rows.length })}
				</p>
			)}

			{/* Decade grouping: only meaningful when sorted by trail km.
					    The checkbox is disabled (and read-only-visual) otherwise,
					    so the user understands why it has no effect. */}
			<label
				className={cn(
					'flex items-center gap-2 text-[10px] tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]',
					sort !== 'trail' && 'opacity-40',
				)}
				title={groupByDecadeLabel}
			>
				<Checkbox checked={groupByDecade} disabled={sort !== 'trail'} onCheckedChange={setGroupByDecade} />
				<span>{groupByDecadeLabel}</span>
			</label>

			{allTags.length > 0 && (
				<div className="flex flex-col gap-1">
					<div className="flex items-center justify-between text-[10px] tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
						<span>{t('tagFilterHeading')}</span>
						{enabledPoiTags.size > 0 && (
							<button
								className="text-cldt-blue focus-visible:ring-cldt-green rounded hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
								type="button"
								onClick={clearPoiTags}
							>
								{t('tagFilterClear')}
							</button>
						)}
					</div>
					<div className="flex flex-wrap gap-1">
						{allTags.map((tag) => {
							const active = enabledPoiTags.has(tag);
							return (
								<button
									aria-pressed={active}
									className={cn(
										'focus-visible:ring-cldt-green inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border px-1.5 text-[10px] transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
										active
											? 'border-cldt-blue bg-cldt-blue text-[var(--marker-on-color)]'
											: 'hover:border-cldt-blue border-gray-300 text-gray-600 dark:border-[var(--border-color)] dark:text-[var(--text-secondary)]',
									)}
									key={tag}
									type="button"
									onClick={() => togglePoiTag(tag)}
								>
									{tag}
								</button>
							);
						})}
					</div>
				</div>
			)}

			<div className="-mr-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1" role="listbox">
				{rows.length === 0 &&
					(poisFile?.pois?.length && poisLayerEnabled && enabledPoiTypes.size === 0 ? (
						<div className="flex flex-col gap-1.5 px-1 py-2">
							<p className="text-xs text-gray-500 italic dark:text-[var(--text-secondary)]">
								{t('noPoiTypesSelected')}
							</p>
							<Button
								className="self-start"
								size="sm"
								variant="mapControlOutline"
								onClick={() => setEnabledPoiTypes(new Set(defaultEnabledPoiTypes))}
							>
								{t('restorePoiTypeDefaults')}
							</Button>
						</div>
					) : (
						<p className="px-1 py-2 text-xs text-gray-500 italic dark:text-[var(--text-secondary)]">
							{poisFile?.pois?.length ? t('listEmptyFiltered') : t('searchLoading')}
						</p>
					))}
				{groupedItems
					? groupedItems.map((item) => {
							if (item.type === 'header') {
								return (
									<div
										className="sticky top-0 z-10 mt-1 bg-[var(--map-tooltip-bg)] px-1 py-1 text-[10px] font-medium tracking-wide text-gray-500 uppercase dark:bg-[var(--bg-primary)] dark:text-[var(--text-secondary)]"
										key={item.key}
									>
										{item.label} · {t('groupCount', { count: item.count })}
									</div>
								);
							}
							return renderRow(item.poi, item.idx);
						})
					: rows.map((poi, i) => renderRow(poi, i))}
			</div>

			<div className="flex flex-col gap-1.5 border-t border-gray-100 pt-2 dark:border-[var(--border-color)]">
				<div className="flex flex-col gap-1">
					<div className="flex items-center justify-between text-[10px] tracking-wide text-gray-500 uppercase dark:text-[var(--text-secondary)]">
						<span>{t('starCollectionHeading')}</span>
						{!creatingStarCollection && (
							<button
								className="text-cldt-blue focus-visible:ring-cldt-green rounded hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
								type="button"
								onClick={() => setCreatingStarCollection(true)}
							>
								{t('starCollectionNew')}
							</button>
						)}
					</div>
					{starCollectionOptions.length > 0 && (
						<MapControlSingleSelect<{ value: string; label: string }>
							aria-label={t('starCollectionSelect')}
							options={starCollectionOptions}
							placeholder={t('starCollectionSelect')}
							value={selectedStarCollectionOption}
							onChange={(val) => {
								if (val) setActiveStarredCollectionId(val.value);
							}}
						/>
					)}
					{starredPoiCollections.map((collection) => {
						const collectionLabel = displayStarCollectionName(collection.name);
						return renamingCollectionId === collection.id ? (
							<MapControlInlineNameForm
								ariaLabel={t('starCollectionNamePlaceholder')}
								cancelLabel={t('starCollectionCancel')}
								confirmLabel={t('filterPresetsConfirm')}
								key={collection.id}
								placeholder={t('starCollectionNamePlaceholder')}
								value={renameCollectionInput}
								onCancel={() => {
									setRenamingCollectionId(null);
									setRenameCollectionInput('');
								}}
								onChange={setRenameCollectionInput}
								onConfirm={handleRenameStarCollection}
							/>
						) : (
							<div className="flex items-center justify-between gap-1 text-xs" key={collection.id}>
								<button
									className={cn(
										'focus-visible:ring-cldt-green truncate text-left hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
										collection.id === activeStarredCollectionId
											? 'text-amber-600 dark:text-amber-400'
											: 'text-cldt-blue',
									)}
									type="button"
									onClick={() => setActiveStarredCollectionId(collection.id)}
								>
									{collectionLabel} ({collection.poiIds.length})
								</button>
								<div className="flex shrink-0 items-center gap-0.5">
									<button
										aria-label={t('starCollectionRename', { name: collectionLabel })}
										className="text-cldt-blue focus-visible:ring-cldt-green rounded px-1 hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
										type="button"
										onClick={() => {
											setRenamingCollectionId(collection.id);
											setRenameCollectionInput(collection.name);
										}}
									>
										✎
									</button>
									<button
										aria-label={t('starCollectionDelete', { name: collectionLabel })}
										className="focus-visible:ring-cldt-green rounded px-1 text-gray-400 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none dark:text-[var(--text-secondary)] dark:hover:text-red-400"
										type="button"
										onClick={() => {
											if (renamingCollectionId === collection.id) {
												setRenamingCollectionId(null);
												setRenameCollectionInput('');
											}
											deleteStarredPoiCollection(collection.id);
										}}
									>
										×
									</button>
								</div>
							</div>
						);
					})}
					{creatingStarCollection && (
						<MapControlInlineNameForm
							ariaLabel={t('starCollectionNamePlaceholder')}
							cancelLabel={t('starCollectionCancel')}
							confirmLabel={t('starCollectionConfirm')}
							placeholder={t('starCollectionNamePlaceholder')}
							value={collectionNameInput}
							onCancel={() => {
								setCreatingStarCollection(false);
								setCollectionNameInput('');
							}}
							onChange={setCollectionNameInput}
							onConfirm={handleCreateStarCollection}
						/>
					)}
				</div>
				{activeStarredPoiIds.size > 0 && (
					<div className="flex items-center justify-between gap-2">
						<span className="text-xs text-amber-600 dark:text-amber-400">
							{t('starredCount', { count: activeStarredPoiIds.size })}
						</span>
						<Button size="sm" variant="mapControlOutlineSecondary" onClick={clearStarredPois}>
							{t('clearStarred')}
						</Button>
					</div>
				)}
			</div>

			{rows.length > 0 && (
				<div className="flex items-center justify-between gap-2">
					<span className="text-xs text-gray-500 dark:text-[var(--text-secondary)]">
						{t('exportSelectionCount', { count: selected.size })}
					</span>
					<Button disabled={selected.size === 0} size="sm" variant="mapControlOutline" onClick={handleExportSelection}>
						{t('exportSelectionButton')}
					</Button>
				</div>
			)}
		</div>
	);

	return (
		<div className="relative inline-block w-10 shrink-0" ref={containerRef}>
			<MapControlsButton
				active={isExpanded}
				ariaLabel={t('listAriaLabel')}
				content={t('listTitle')}
				title={t('listTitle')}
				onClick={onToggle}
			>
				<IoLocationOutline aria-hidden className="h-5 w-5" />
			</MapControlsButton>
			{isExpanded && typeof document !== 'undefined' && createPortal(popoverContent, document.body)}
			{typeof document !== 'undefined' &&
				createPortal(
					<MapControlsPoiDisclaimerModal
						open={disclaimerOpen}
						onCancel={() => setDisclaimerOpen(false)}
						onConfirm={() => {
							seedDefaultFiltersIfPristine();
							setPoisLayerEnabled(true);
							setDisclaimerOpen(false);
						}}
						onDismissFor30Days={() => {
							seedDefaultFiltersIfPristine();
							setPoisLayerEnabled(true);
							setPoiDisclaimerDismissedAt(Date.now());
							setDisclaimerOpen(false);
						}}
					/>,
					document.body,
				)}
		</div>
	);
}
