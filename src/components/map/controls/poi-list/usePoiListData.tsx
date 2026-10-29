'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import { useLocale, useTranslations } from 'next-intl';
import { type GroupBase } from 'react-select';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
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
import { TRAIL_OFF_TRAIL_THRESHOLD_M } from '@/lib/config';
import {
	WATER_RELIABILITY_OPTIONS,
	poiMatchesWaterReliabilityFilter,
	type WaterReliability,
} from '@/lib/water-intelligence';
import { aheadCorridorSoboRange, formatAheadHorizon, poiAheadKm, resolveTrailAnchor } from '@/lib/poi-ahead-corridor';
import {
	usePoiListRows,
	usePopoverFocusTrap,
	useActiveStarredPoiIds,
	type ParsedDistance,
	type SortMode,
} from '@/hooks';
import { kmToUnit } from '@/lib/units';
import { findNearestPointIndex } from '@/lib/distance-utils';
import { haversineDistanceM } from '@/lib/haversine';
import { buildGpxWaypointXml, downloadGpxFile, type GpxWaypoint } from '@/lib/gpx-export';
import { DistanceUnit } from '@/lib/types';
import { toTravelRange } from '@/lib/trail-frame';
import { PoiListRow } from './PoiListRow';

/** Window after which the POI disclaimer must be shown again (30 days). */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// formatJumpLabel intentionally bypasses the metric/imperial conversion
// in formatDistance (format.ts): parseDistanceQuery returns values already
// in the user's active unit (km or mi), so no conversion is needed here.
function formatJumpLabel(distance: number, unit: DistanceUnit): string {
	const rounded = Math.round(distance * 10) / 10;
	return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)} ${unit}`;
}

/** State, derived rows and handlers of the POI list, shared by its cards. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the returned object is the cards' contract; PoiListData is its inferred type
export function usePoiListData({ isExpanded, onClose }: { isExpanded: boolean; onClose: () => void }) {
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
	const poiListFiltersOpen = useMapStore((s: MapStoreState) => s.poiListFiltersOpen);
	const setPoiListFiltersOpen = useMapStore((s: MapStoreState) => s.setPoiListFiltersOpen);
	const poiListSortOpen = useMapStore((s: MapStoreState) => s.poiListSortOpen);
	const setPoiListSortOpen = useMapStore((s: MapStoreState) => s.setPoiListSortOpen);
	const poiListTagsOpen = useMapStore((s: MapStoreState) => s.poiListTagsOpen);
	const setPoiListTagsOpen = useMapStore((s: MapStoreState) => s.setPoiListTagsOpen);
	const poiListStarsOpen = useMapStore((s: MapStoreState) => s.poiListStarsOpen);
	const setPoiListStarsOpen = useMapStore((s: MapStoreState) => s.setPoiListStarsOpen);
	const poiListExportOpen = useMapStore((s: MapStoreState) => s.poiListExportOpen);
	const setPoiListExportOpen = useMapStore((s: MapStoreState) => s.setPoiListExportOpen);
	const rulerRange = useMapStore((s: MapStoreState) => s.rulerRange);
	const closestPoint = useStore((s: StoreState) => s.closestPoint);
	const trailMetadata = useStore((s: StoreState) => s.trailMetadata);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);
	const highlightTrailPosition = useStore((s: StoreState) => s.highlightTrailPosition);
	const setTooltipPinnedFromShare = useStore((s: StoreState) => s.setTooltipPinnedFromShare);
	const popoverRef = usePopoverFocusTrap(isExpanded);
	const searchInputRef = useRef<HTMLInputElement | null>(null);

	const [sortChoice, setSort] = useState<SortMode>('trail');
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
	// Ahead order needs an anchor; while there is none, the list runs in trail order.
	const sort: SortMode = sortChoice === 'ahead' && !trailAnchor ? 'trail' : sortChoice;

	// Deep-link from Up next chip or stage planner preview; the effect clears the request.
	if (isExpanded && pendingPoiListSort === 'ahead' && sortChoice !== 'ahead') setSort('ahead');
	useEffect(() => {
		if (isExpanded && pendingPoiListSort === 'ahead') clearPendingPoiListSort();
	}, [isExpanded, pendingPoiListSort, clearPendingPoiListSort]);

	// On the first GPS lock, switch from the default 'trail' sort to 'gps'. Only
	// that first lock counts, so later picks (including returning to 'trail')
	// are preserved.
	const [gpsLockSeen, setGpsLockSeen] = useState(false);
	if (hasGps && !gpsLockSeen) {
		setGpsLockSeen(true);
		if (sort === 'trail') setSort('gps');
	}

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

	// Reset the cursor whenever the underlying row set changes (sort, filter,
	// debouncedQuery, tag filter, GPS distance recompute - all of which feed
	// into `rows` via usePoiListRows) so we never highlight a stale index.
	const [cursorRows, setCursorRows] = useState(rows);
	if (rows !== cursorRows) {
		setCursorRows(rows);
		setActiveIndex(null);
	}

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
		const { from: fromTrailKm, to: toTrailKm } = toTravelRange(range.from, range.to, direction, totalKm);
		return t('aheadSummary', {
			count: rows.length,
			from: kmToUnit(fromTrailKm, units).toFixed(0),
			to: kmToUnit(toTrailKm, units).toFixed(0),
			unit: units === 'imperial' ? 'mi' : 'km',
		});
	}, [sort, anchorSoboKm, aheadHorizonKm, direction, totalKm, rows.length, units, t]);

	// Drop transient state on close so reopening starts clean.
	const [wasExpanded, setWasExpanded] = useState(isExpanded);
	if (isExpanded !== wasExpanded) {
		setWasExpanded(isExpanded);
		if (!isExpanded) {
			setSelected(new Set());
			setQuery('');
		}
	}

	useEffect(() => {
		// Focus the search input on open so the user can type immediately.
		if (isExpanded) queueMicrotask(() => searchInputRef.current?.focus());
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

	return {
		activeStarredCollectionId,
		activeStarredPoiIds,
		aheadHorizonKm,
		aheadSummary,
		allTags,
		applyPoiFilterPreset,
		clearPoiTags,
		clearStarredPois,
		collectionNameInput,
		creatingStarCollection,
		deletePoiFilterPreset,
		deleteStarredPoiCollection,
		disclaimerOpen,
		displayStarCollectionName,
		distancePrecision,
		enabledPoiTags,
		enabledPoiTypes,
		enabledWaterReliability,
		filterPresetOptions,
		groupByDecade,
		groupByDecadeLabel,
		groupedItems,
		handleCreateStarCollection,
		handleExportSelection,
		handleJump,
		handleKeyDown,
		handlePoisLayerToggle,
		handleRenameFilterPreset,
		handleRenameStarCollection,
		handleSaveFilterPreset,
		hiddenByReachabilityCount,
		includeRemotePois,
		jumpLabel,
		parsedDistance,
		poiFilterPresets,
		poiListExportOpen,
		poiListFiltersOpen,
		poiListSortOpen,
		poiListStarsOpen,
		poiListTagsOpen,
		poisFile,
		poisLayerEnabled,
		popoverRef,
		presetNameInput,
		query,
		renameCollectionInput,
		renamePresetInput,
		renamingCollectionId,
		renamingPresetId,
		renderRow,
		rows,
		savingFilterPreset,
		searchInputRef,
		seedDefaultFiltersIfPristine,
		selected,
		selectedSortOption,
		selectedStarCollectionOption,
		selectedTypeOptions,
		selectedWaterReliabilityOptions,
		setActiveStarredCollectionId,
		setAheadHorizonKm,
		setCollectionNameInput,
		setCreatingStarCollection,
		setDisclaimerOpen,
		setEnabledPoiTypes,
		setEnabledWaterReliability,
		setGroupByDecade,
		setIncludeRemotePois,
		setPoiDisclaimerDismissedAt,
		setPoiListExportOpen,
		setPoiListFiltersOpen,
		setPoiListSortOpen,
		setPoiListStarsOpen,
		setPoiListTagsOpen,
		setPoisLayerEnabled,
		setPresetNameInput,
		setQuery,
		setRenameCollectionInput,
		setRenamePresetInput,
		setRenamingCollectionId,
		setRenamingPresetId,
		setSavingFilterPreset,
		setSort,
		showWaterReliabilityFilter,
		sort,
		sortOptions,
		starCollectionOptions,
		starredPoiCollections,
		t,
		togglePoiTag,
		trailAnchor,
		typeCounts,
		typeOptions,
		units,
		waterReliabilityOptions,
	};
}

export type PoiListData = ReturnType<typeof usePoiListData>;
