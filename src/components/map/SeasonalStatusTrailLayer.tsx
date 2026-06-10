'use client';

/**
 * Seasonal trail status overlay, extracted from TrailRoute.
 *
 * Renders one severity-colored chip marker per active seasonal-status entry
 * (anchored at the midpoint of the entry's affected km range) and a halo
 * polyline along the affected stretch for whichever entry is "active"
 * (hovered or open in the modal). Headless: returns null and manages Leaflet
 * layers imperatively, reading everything it needs from the stores.
 */
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useLocale, useTranslations } from 'next-intl';
import { formatSeasonalDateRange, severityColor, type SeasonalStatusEntry } from '@/lib/seasonal-status';
import { type EnhancedTrailPoint, type MapStoreState, type StoreState, useMapStore, useStore } from '@/lib/store';

/**
 * Pane for the seasonal-status halo polyline, drawn under the trail when an
 * entry is hovered or has its modal open. Z-index sits just above the base
 * trail, so the highlight reads clearly without competing with the markers above.
 */
const SEASONAL_STATUS_PANE = 'seasonalStatusPane';
/**
 * Pane for seasonal-status chip markers (one per active entry, at the midpoint
 * of the affected km range). Sits above the halo so the chip is always on top.
 */
const SEASONAL_STATUS_MARKER_PANE = 'seasonalStatusMarkerPane';
/**
 * Pane for the chip-marker hover tooltip. Must outrank the marker pane so the
 * tooltip card sits on top of the chip instead of being clipped behind it.
 */
const SEASONAL_STATUS_TOOLTIP_PANE = 'seasonalStatusTooltipPane';
/** Halo stroke weight in pixels. */
const SEASONAL_STATUS_HALO_WEIGHT = 16;
/** Halo stroke opacity. */
const SEASONAL_STATUS_HALO_OPACITY = 0.32;
/** SVG glyph rendered inside every chip marker (a warning exclamation). */
const SEASONAL_STATUS_CHIP_GLYPH =
	'<svg viewBox="0 0 10 12" width="10" height="12" aria-hidden="true">' +
	'<rect x="4" y="2" width="2" height="6" rx="1" fill="white"/>' +
	'<circle cx="5" cy="10" r="1.2" fill="white"/>' +
	'</svg>';

function escapeHtmlAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSeasonalChipIcon(entry: SeasonalStatusEntry, ariaLabel: string): L.DivIcon {
	const color = severityColor(entry.severity);
	const safeLabel = escapeHtmlAttr(ariaLabel);
	const html =
		`<span class="seasonal-status-chip" style="--seasonal-chip-color:${color};background:${color}" ` +
		`aria-label="${safeLabel}">${SEASONAL_STATUS_CHIP_GLYPH}</span>`;
	return L.divIcon({
		className: 'seasonal-status-chip-wrapper',
		html,
		iconSize: [22, 22],
		iconAnchor: [11, 11],
	});
}

/** Finds the index in `points` whose `distanceFromStart` is closest to `targetM`.
 *  `points` are assumed sorted ascending on distanceFromStart (the upstream
 *  pipeline guarantees this). Binary-searches the position then picks the
 *  closer of the two neighbors. */
function nearestPointByDistanceM(points: EnhancedTrailPoint[], targetM: number): number {
	if (points.length === 0) return 0;
	let lo = 0;
	let hi = points.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (points[mid].distanceFromStart < targetM) lo = mid + 1;
		else hi = mid;
	}
	if (
		lo > 0 &&
		Math.abs(points[lo - 1].distanceFromStart - targetM) < Math.abs(points[lo].distanceFromStart - targetM)
	) {
		return lo - 1;
	}
	return lo;
}

export default function SeasonalStatusTrailLayer(): null {
	const map = useMap();
	const locale = useLocale();
	const tSeasonal = useTranslations('seasonalStatus');

	const enhancedTrailPoints = useStore((state: StoreState) => state.enhancedTrailPoints);
	const seasonalStatusEntries = useMapStore((state: MapStoreState) => state.seasonalStatusEntries);
	const seasonalStatusLayerEnabled = useMapStore((state: MapStoreState) => state.seasonalStatusLayerEnabled);
	const setSeasonalStatusModalEntry = useMapStore((state: MapStoreState) => state.setSeasonalStatusModalEntry);
	const seasonalStatusModalEntry = useMapStore((state: MapStoreState) => state.seasonalStatusModalEntry);
	const seasonalStatusHoveredEntryId = useMapStore((state: MapStoreState) => state.seasonalStatusHoveredEntryId);
	const setSeasonalStatusHoveredEntryId = useMapStore((state: MapStoreState) => state.setSeasonalStatusHoveredEntryId);

	const seasonalChipMarkersRef = useRef<Map<string, L.Marker>>(new Map());
	const seasonalHaloRef = useRef<L.Polyline | null>(null);

	// Panes; z-index order set in map.css. Idempotent against TrailRoute having
	// created them in an earlier app version (createPane throws on duplicates).
	useEffect(() => {
		const ensurePane = (name: string, className: string): void => {
			if (map.getPane(name)) return;
			map.createPane(name);
			map.getPane(name)?.classList.add(className);
		};
		ensurePane(SEASONAL_STATUS_PANE, 'seasonal-status-pane');
		ensurePane(SEASONAL_STATUS_MARKER_PANE, 'seasonal-status-marker-pane');
		ensurePane(SEASONAL_STATUS_TOOLTIP_PANE, 'seasonal-status-tooltip-pane');
	}, [map]);

	// Build one chip marker per active seasonal-status entry, anchored at the
	// midpoint of the entry's km range. Hover sets the hovered-entry id (which
	// drives the halo); click opens the modal. Direction is unused here because
	// distanceFromStart is direction-agnostic SOBO meters.
	useEffect(() => {
		if (!map) return;

		const markers = seasonalChipMarkersRef.current;
		// Tear down previous markers before deciding whether to draw new ones.
		markers.forEach((m) => {
			map.removeLayer(m);
		});
		markers.clear();

		if (!seasonalStatusLayerEnabled) return;
		if (!enhancedTrailPoints || enhancedTrailPoints.length < 2) return;
		if (seasonalStatusEntries.length === 0) return;

		const drawable = seasonalStatusEntries.filter(
			(e) => typeof e.distanceStartKm === 'number' && typeof e.distanceEndKm === 'number',
		);

		for (const entry of drawable) {
			const startKm = entry.distanceStartKm as number;
			const endKm = entry.distanceEndKm as number;
			const midM = ((startKm + endKm) / 2) * 1000;
			const idx = nearestPointByDistanceM(enhancedTrailPoints, midM);
			const pt = enhancedTrailPoints[idx];

			const ariaLabel = tSeasonal('chipAriaLabel', {
				severity: tSeasonal(`severity.${entry.severity}`),
				source: entry.source,
			});
			const icon = buildSeasonalChipIcon(entry, ariaLabel);
			const marker = L.marker(L.latLng(pt.lat, pt.lng), {
				icon,
				pane: SEASONAL_STATUS_MARKER_PANE,
				keyboard: true,
				riseOnHover: true,
			});
			const severityLabel = tSeasonal(`severity.${entry.severity}`);
			const dateRange = formatSeasonalDateRange(entry.validFrom, entry.validUntil, locale);
			const validLabel = tSeasonal('validLabel');
			const tooltipHtml =
				`<div class="map-tooltip__inner">` +
				`<p class="font-semibold text-sm mb-0.5" style="color:${severityColor(entry.severity)}">${escapeHtmlAttr(severityLabel)}</p>` +
				`<p class="text-xs">${escapeHtmlAttr(entry.source)}</p>` +
				`<p class="text-xs opacity-75 mt-0.5"><span class="font-medium">${escapeHtmlAttr(validLabel)}</span> ${escapeHtmlAttr(dateRange)}</p>` +
				`</div>`;
			marker.bindTooltip(tooltipHtml, {
				direction: 'top',
				offset: L.point(0, -8),
				permanent: false,
				className: 'map-tooltip map-tooltip--compact seasonal-status-chip-tooltip',
				pane: SEASONAL_STATUS_TOOLTIP_PANE,
			});
			// Set the per-severity accent on the tooltip element each time it opens,
			// mirroring the modal's CSS-var pattern so the left accent border picks
			// up the correct color.
			const chipAccent = severityColor(entry.severity);
			marker.on('tooltipopen', (e: L.LeafletEvent) => {
				const tooltip = (e as unknown as { tooltip: L.Tooltip }).tooltip;
				const el = tooltip.getElement();
				if (el) el.style.setProperty('--seasonal-accent', chipAccent);
			});
			marker.on('mouseover', () => {
				setSeasonalStatusHoveredEntryId(entry.id);
			});
			marker.on('mouseout', () => {
				setSeasonalStatusHoveredEntryId(null);
			});
			marker.on('click', (e: L.LeafletMouseEvent) => {
				L.DomEvent.stopPropagation(e);
				setSeasonalStatusModalEntry(entry);
			});
			marker.addTo(map);
			markers.set(entry.id, marker);
		}

		return () => {
			markers.forEach((m) => {
				map.removeLayer(m);
			});
			markers.clear();
		};
	}, [
		map,
		enhancedTrailPoints,
		seasonalStatusEntries,
		seasonalStatusLayerEnabled,
		setSeasonalStatusHoveredEntryId,
		setSeasonalStatusModalEntry,
		tSeasonal,
		locale,
	]);

	// Render a halo polyline along the affected range for whichever entry is
	// currently "active" (hovered OR open in the modal). The active marker also
	// gets an `is-active` class so its chip can light up.
	useEffect(() => {
		if (!map) return;

		const activeEntryId = seasonalStatusHoveredEntryId ?? seasonalStatusModalEntry?.id ?? null;

		// Update marker active-state classes.
		seasonalChipMarkersRef.current.forEach((marker, id) => {
			const el = marker.getElement();
			if (el) el.classList.toggle('is-active', id === activeEntryId);
		});

		// Tear down any existing halo before deciding whether to redraw.
		if (seasonalHaloRef.current) {
			map.removeLayer(seasonalHaloRef.current);
			seasonalHaloRef.current = null;
		}

		if (!activeEntryId) return;
		if (!seasonalStatusLayerEnabled) return;
		if (!enhancedTrailPoints || enhancedTrailPoints.length < 2) return;

		const activeEntry = seasonalStatusEntries.find((e) => e.id === activeEntryId);
		if (!activeEntry) return;
		if (typeof activeEntry.distanceStartKm !== 'number' || typeof activeEntry.distanceEndKm !== 'number') {
			return;
		}

		const startM = activeEntry.distanceStartKm * 1000;
		const endM = activeEntry.distanceEndKm * 1000;
		const haloCoords: L.LatLngTuple[] = [];
		for (const p of enhancedTrailPoints) {
			if (p.distanceFromStart >= startM && p.distanceFromStart <= endM) {
				haloCoords.push([p.lat, p.lng]);
			}
		}
		if (haloCoords.length < 2) return;

		const halo = L.polyline(haloCoords, {
			color: severityColor(activeEntry.severity),
			weight: SEASONAL_STATUS_HALO_WEIGHT,
			opacity: SEASONAL_STATUS_HALO_OPACITY,
			lineCap: 'round',
			lineJoin: 'round',
			interactive: false,
			pane: SEASONAL_STATUS_PANE,
		});
		halo.addTo(map);
		seasonalHaloRef.current = halo;

		return () => {
			if (seasonalHaloRef.current) {
				map.removeLayer(seasonalHaloRef.current);
				seasonalHaloRef.current = null;
			}
		};
	}, [
		map,
		seasonalStatusHoveredEntryId,
		seasonalStatusModalEntry,
		seasonalStatusEntries,
		seasonalStatusLayerEnabled,
		enhancedTrailPoints,
	]);

	return null;
}
