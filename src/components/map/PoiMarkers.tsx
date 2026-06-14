'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useLocale, useTranslations } from 'next-intl';
import { useMapStore, type MapStoreState } from '@/lib/store';
import { isKnownType, poiDisplayName, poiMatchesTagFilter, poiPassesReachabilityFilter, type Poi } from '@/lib/pois';
import {
	buildPoiShareUrl,
	clearShareUrlParams,
	getInitialShareUrlParams,
	isSafeUrl,
	openCoordinatesInMaps,
} from '@/lib/utils';
import { usePathname, useRouter } from '@/i18n/navigation';
import { wirePopupShareButton } from '@/lib/share-link-copy';
import { newId } from '@/lib/user-waypoints';
import { poiTypeToSuggestedWaypointCategory } from '@/lib/waypoint-categories';
import { fetchWikipediaSummary, truncateExtract } from '@/lib/wikipedia';
import {
	CLUSTER_CELL_PX,
	CLUSTER_MAX_ZOOM,
	buildClusterIcon,
	buildIcon,
	clusterPois,
} from '@/components/map/poi-marker-utils';
import { buildPopupHtml, type PopupBuildLabels } from '@/components/map/poi-popup-builders';

const POI_PANE = 'poiMarkerPane';
const POI_TOOLTIP_PANE = 'poiTooltipPane';

/** Deep-link popup: how many times to retry waiting for a marker to appear
 *  after flyTo / moveend before giving up (~3 seconds at 200 ms per tick). */
const DEEPLINK_MAX_POLL_ATTEMPTS = 15;
/** Deep-link popup: milliseconds between each marker-existence poll tick. */
const DEEPLINK_POLL_INTERVAL_MS = 200;

/** Ensure a shared POI link can materialise a marker (layer, type, tag filter). */
function preparePoiDeepLink(poi: Poi): void {
	const store = useMapStore.getState();
	if (!store.poisLayerEnabled) {
		store.setPoisLayerEnabled(true);
	}
	if (!store.enabledPoiTypes.has(poi.type)) {
		store.togglePoiType(poi.type);
	}
	if (!poiMatchesTagFilter(poi, store.enabledPoiTags)) {
		store.setEnabledPoiTags(new Set());
	}
	if (!poiPassesReachabilityFilter(poi, store.includeRemotePois)) {
		store.setIncludeRemotePois(true);
	}
}

/**
 * Renders POI markers on the map. Markers respect the master layer toggle and
 * the per-type filter from the map store. Clicks open a Leaflet popup with
 * the POI name, type, trail km, and on-trail-or-not indicator. The popup is
 * built with the shared `.map-tooltip` styling so it matches the trail-point
 * tooltip, severe-weather banner, and seasonal-status modal visually.
 *
 * Direction- and unit-aware: when the user flips SOBO ↔ NOBO or toggles
 * metric/imperial, popups are torn down and rebuilt with the new framing
 * (the effect dep array includes `direction` and `units`).
 *
 * Future types only need entries added to TYPE_SIZE and TYPE_COLOR; the
 * rest of the pipeline is type-agnostic.
 */
export function PoiMarkers(): null {
	const map = useMap();
	const router = useRouter();
	const pathname = usePathname();
	const t = useTranslations('pois');
	const locale = useLocale();
	const poisFile = useMapStore((s: MapStoreState) => s.poisFile);
	const poisLayerEnabled = useMapStore((s: MapStoreState) => s.poisLayerEnabled);
	const gpxLoaded = useMapStore((s: MapStoreState) => s.gpxLoaded);
	const enabledPoiTypes = useMapStore((s: MapStoreState) => s.enabledPoiTypes);
	const enabledPoiTags = useMapStore((s: MapStoreState) => s.enabledPoiTags);
	const includeRemotePois = useMapStore((s: MapStoreState) => s.includeRemotePois);
	const openLightbox = useMapStore((s: MapStoreState) => s.openLightbox);
	const pendingOpenPoiId = useMapStore((s: MapStoreState) => s.pendingOpenPoiId);
	const requestOpenPoi = useMapStore((s: MapStoreState) => s.requestOpenPoi);
	const clearPendingOpenPoi = useMapStore((s: MapStoreState) => s.clearPendingOpenPoi);
	const direction = useMapStore((s: MapStoreState) => s.direction);
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);

	const visiblePois = useMemo((): Poi[] => {
		if (!poisFile || !poisLayerEnabled) return [];
		return poisFile.pois.filter(
			(p) =>
				isKnownType(p.type) &&
				enabledPoiTypes.has(p.type) &&
				poiMatchesTagFilter(p, enabledPoiTags) &&
				poiPassesReachabilityFilter(p, includeRemotePois),
		);
	}, [poisFile, poisLayerEnabled, enabledPoiTypes, enabledPoiTags, includeRemotePois]);

	/** id -> Poi index used by the deep-link and in-app open-by-id paths so they
	 *  can resolve a target POI in O(1) instead of scanning the full ~8k row
	 *  array on every navigation event. */
	const poiById = useMemo(() => new Map<string, Poi>((poisFile?.pois ?? []).map((p) => [p.id, p])), [poisFile]);

	const totalKm = useMemo(() => poisFile?.pois.reduce((m, p) => (p.trailKm > m ? p.trailKm : m), 0) ?? 0, [poisFile]);

	const markersRef = useRef<L.Marker[]>([]);
	/** id → marker map used by the deep-link effect to open a popup by id
	 *  after a `?poi=<id>` is detected on load. Re-populated on every render
	 *  pass that emits individual (non-clustered) markers. */
	const markerByIdRef = useRef<Map<string, L.Marker>>(new Map());
	/** Suppress re-opening the deep-link popup more than once per page load.
	 *  Without this the effect would re-fire on every zoom (because zoom
	 *  triggers a re-render of markers, which is in the dep array transitively). */
	const deepLinkAppliedRef = useRef(false);
	/** Sorted comma-joined candidate id string used as the dirty-check key
	 *  for renderMarkers. When the new key matches the prior one we skip the
	 *  expensive teardown + rebuild cycle. */
	const prevCandidateIdsRef = useRef<string>('');

	/** Pre-sorted candidate id list for the visiblePois superset. Sorted once
	 *  when visiblePois changes so the per-renderMarkers dirty-check doesn't
	 *  re-sort the same ids on every pan. */
	const sortedVisiblePoiIds = useMemo(
		() =>
			visiblePois
				.map((p) => p.id)
				.sort()
				.join(','),
		[visiblePois],
	);

	// Create dedicated panes once.
	useEffect(() => {
		if (!map.getPane(POI_PANE)) {
			map.createPane(POI_PANE);
			map.getPane(POI_PANE)?.classList.add('poi-marker-pane');
		}
		if (!map.getPane(POI_TOOLTIP_PANE)) {
			map.createPane(POI_TOOLTIP_PANE);
			map.getPane(POI_TOOLTIP_PANE)?.classList.add('poi-tooltip-pane');
		}
	}, [map]);

	useEffect(() => {
		// Force marker rebuild when visiblePois changes. The moveend dirty-check
		// compares viewport candidate ids only; toggling reachability (or other
		// filters) can change the superset without changing in-view ids, which
		// previously cleared markers in cleanup then skipped re-adding them.
		prevCandidateIdsRef.current = '';

		const popupLabels: PopupBuildLabels = {
			distanceLabel: t('trailPositionLabel'),
			offTrailLabel: t('offTrailLabel'),
			elevationLabel: t('elevationLabel'),
			phoneLabel: t('phoneLabel'),
			capacityLabel: t('capacityLabel'),
			seasonLabel: t('seasonLabel'),
			populationLabel: t('populationLabel'),
			wikipediaLoading: t('wikipediaLoading'),
			wikipediaSource: t('wikipediaSource'),
			shareLink: t('shareLink'),
			shareCopied: t('shareCopied'),
			shareCopiedShort: t('shareCopiedShort'),
			shareFailed: t('shareFailed'),
			openInMaps: t('openInMaps'),
			addAsWaypoint: t('addAsWaypoint'),
			publicTransportEscape: t.raw('publicTransportEscape'),
			starAddLabel: t('starAdd', { name: '' }).replace(/\s+/g, ' ').trim(),
			starRemoveLabel: t('starRemove', { name: '' }).replace(/\s+/g, ' ').trim(),
			sourceOsm: t('sourceOsm'),
			sourceWikidata: t('sourceWikidata'),
			sourceHps: t('sourceHps'),
			sourceCurated: t('sourceCurated'),
			lastVerifiedLabel: t('lastVerified'),
			galleryImageLabel: t('galleryImageLabel'),
			waterReliable: t('water.reliable'),
			waterSeasonal: t('water.seasonal'),
			waterUnverified: t('water.unverified'),
			waterNotPotable: t('water.not_potable'),
			waterCheckedLabel: t('water.checked'),
			resupplyHeading: t('resupply.heading'),
			resupplyNone: t('resupply.none'),
			// Raw templates: the popup builder substitutes {date}/{count} itself
			// (it runs outside React), so t() would error on missing variables.
			resupplyVerify: t.raw('resupply.verify'),
			resupplyMore: t.raw('resupply.more'),
			resupplyKinds: {
				grocery: t('resupply.grocery'),
				bakery: t('resupply.bakery'),
				pharmacy: t('resupply.pharmacy'),
				atm: t('resupply.atm'),
				post: t('resupply.post'),
				bus: t('resupply.bus'),
				fuel: t('resupply.fuel'),
			},
		};

		/** Re-render markers for the current zoom. Above CLUSTER_MAX_ZOOM we
		 *  emit one Leaflet marker per POI. Below, we group nearby POIs into a
		 *  count-bearing cluster marker; cluster click zooms into the cluster's
		 *  bounding box so it expands into individual markers naturally. */
		const renderMarkers = (): void => {
			if (visiblePois.length === 0) {
				for (const m of markersRef.current) map.removeLayer(m);
				markersRef.current = [];
				markerByIdRef.current.clear();
				prevCandidateIdsRef.current = '';
				return;
			}

			const currentZoom = map.getZoom();
			const shouldCluster = currentZoom < CLUSTER_MAX_ZOOM;
			// Viewport culling: when rendering individual markers (zoom >= 12),
			// only materialise POIs inside the current map bounds + a 25% pad
			// so pans within the pad don't flicker. At low zoom every POI
			// shares one cluster cell anyway, so clustering already serves as
			// implicit culling - skip the bounds filter there.
			let candidates = visiblePois;
			if (!shouldCluster) {
				const bounds = map.getBounds().pad(0.25);
				candidates = visiblePois.filter((p) => bounds.contains([p.lat, p.lng]));
				if (candidates.length === 0) {
					for (const m of markersRef.current) map.removeLayer(m);
					markersRef.current = [];
					markerByIdRef.current.clear();
					prevCandidateIdsRef.current = '';
					return;
				}
			}

			// Shallow dirty-check: skip teardown when the candidate set hasn't
			// moved. Cluster path reuses the pre-sorted visiblePois superset
			// (sortedVisiblePoiIds memo). Non-cluster path joins ids WITHOUT
			// sorting: candidates are a filter of visiblePois, so identical
			// sets always arrive in identical order - the previous per-moveend
			// sort bought nothing.
			const newCandidateIds = shouldCluster ? sortedVisiblePoiIds : candidates.map((p) => p.id).join(',');
			if (newCandidateIds === prevCandidateIdsRef.current) return;
			prevCandidateIdsRef.current = newCandidateIds;

			for (const m of markersRef.current) {
				map.removeLayer(m);
			}
			markersRef.current = [];
			markerByIdRef.current.clear();

			// When clustering is off, skip the PoiCluster wrapper allocation:
			// candidates are rendered directly in the loop below via the
			// shouldCluster branch. When clustering is on, compute the cell grid.
			const clusters = shouldCluster ? clusterPois(visiblePois, map, CLUSTER_CELL_PX) : [];

			// Helper: attach a single-POI Leaflet marker to the map.
			const addPoiMarker = (poi: (typeof visiblePois)[number]): void => {
				const displayName = poiDisplayName(poi, locale);
				const typeLabel = t(`type.${poi.type}`, { default: poi.type });
				const ariaLabel = `${displayName} - ${typeLabel}`;
				// Per-POI star labels: interpolate the POI's own display name so
				// the popup tooltip reads "Star Dugo Selo for trip brief" rather
				// than the generic "Star for trip brief".
				const poiLabels = {
					...popupLabels,
					starAddLabel: t('starAdd', { name: displayName }),
					starRemoveLabel: t('starRemove', { name: displayName }),
				};
				const marker = L.marker([poi.lat, poi.lng], {
					icon: buildIcon(poi, ariaLabel),
					pane: POI_PANE,
					keyboard: true,
					riseOnHover: true,
					title: displayName,
				});
				// Lazy popup HTML: Leaflet calls the factory on first open,
				// so 6000+ markers don't pay the string-concat cost up front.
				// Captured deps (direction, units, ...) come from the render
				// closure - the popup will reflect the values active at the
				// moment of opening, which is the desired behaviour anyway.
				marker.bindPopup(
					() =>
						buildPopupHtml(poi, displayName, typeLabel, {
							direction,
							units,
							totalKm,
							distancePrecision,
							locale,
							labels: poiLabels,
							// Called via .getState() (not a selector hook) because this
							// factory runs lazily at popup-open time, outside the React
							// render path, so subscription-based hooks are not available.
							isStarred: useMapStore.getState().starredPoiIds.has(poi.id),
						}),
					{
						closeButton: true,
						autoPan: true,
						// Only `poi-popup` - omitting `map-tooltip` here so the
						// outer Leaflet popup wrapper doesn't pick up the
						// shared blue-border chrome on top of the inner
						// content wrapper (the cause of the nested-popup
						// look). All the chrome lives on .leaflet-popup-content-wrapper
						// via the .poi-popup CSS.
						className: 'poi-popup',
					},
				);
				// Lazy-fetch Wikipedia summary on first popup open. Cached for
				// the page lifetime by fetchWikipediaSummary, so re-opening the
				// same popup is free.
				marker.on('popupopen', () => {
					// Only run the live Wikipedia fetch when we haven't already
					// baked a summary at enrichment time. Phase 5 covers most
					// notable POIs, so this path usually no-ops.
					const hasBakedSummary = !!(poi.summary_en ?? poi.summary_hr);
					if (poi.wikipedia && !hasBakedSummary) {
						void hydrateWikipediaSnippet(marker, poi, popupLabels.wikipediaSource);
					}
					wireGalleryButtons(marker, poi, openLightbox);
					wireOpenInMapsButton(marker, poi);
					wireAddAsWaypointButton(marker, poi, poiDisplayName(poi, locale));
					wireShareButton(marker, poi, popupLabels.shareLink);
					wireStarButton(marker, poi, {
						starAddLabel: poiLabels.starAddLabel,
						starRemoveLabel: poiLabels.starRemoveLabel,
					});
					// Mark the active marker so its dot stays in the hover-style
					// "selected" visual (scaled up) for as long as the popup is
					// open, not just while focus / press is held. The matching
					// CSS rule lives next to the :hover scale-up in map.css.
					marker.getElement()?.classList.add('poi-marker-wrapper--selected');
				});
				marker.on('popupclose', () => {
					marker.getElement()?.classList.remove('poi-marker-wrapper--selected');
				});
				marker.addTo(map);
				markersRef.current.push(marker);
				markerByIdRef.current.set(poi.id, marker);
			};

			if (!shouldCluster) {
				// Non-clustering path: render each candidate directly without
				// wrapping it in a PoiCluster object.
				for (const poi of candidates) {
					addPoiMarker(poi);
				}
			} else {
				for (const cluster of clusters) {
					if (cluster.pois.length === 1) {
						addPoiMarker(cluster.pois[0]);
					} else {
						const ariaLabel = t('clusterAriaLabel', { count: cluster.pois.length });
						const icon = buildClusterIcon(cluster.pois.length, ariaLabel);
						const marker = L.marker([cluster.lat, cluster.lng], {
							icon,
							pane: POI_PANE,
							keyboard: true,
							riseOnHover: true,
							title: ariaLabel,
						});
						// Click: fit map bounds to the cluster's contents (with small
						// padding) so the cluster naturally expands.
						marker.on('click', () => {
							const bounds = L.latLngBounds(cluster.pois.map((p) => [p.lat, p.lng] as L.LatLngTuple));
							map.fitBounds(bounds, { padding: [40, 40], maxZoom: CLUSTER_MAX_ZOOM + 1 });
						});
						marker.addTo(map);
						markersRef.current.push(marker);
					}
				}
			}
		};

		renderMarkers();
		// `moveend` fires after both pan and zoom, so a single listener
		// covers viewport-culling refresh (pan) and cluster-grid recompute
		// (zoom). Listening to zoomend separately would double-fire.
		map.on('moveend', renderMarkers);

		// Capture the current array / map at effect-creation time so the
		// cleanup closure holds a reference to the exact collection rendered
		// by this effect, rather than reading `ref.current` which may have
		// been replaced by a subsequent render before cleanup runs.
		const markersAtCreate = markersRef.current;
		const markerByIdAtCreate = markerByIdRef.current;
		return () => {
			map.off('moveend', renderMarkers);
			for (const m of markersAtCreate) {
				map.removeLayer(m);
			}
			markersAtCreate.length = 0;
			markerByIdAtCreate.clear();
		};
	}, [map, visiblePois, sortedVisiblePoiIds, locale, t, direction, units, totalKm, distancePrecision, openLightbox]);

	/** Fly to a POI's coordinates past the cluster threshold so it gets a
	 *  dedicated marker, then bounded-poll for the marker and open its popup.
	 *  Shared by the deep-link consumer and the in-app open requests. */
	const flyAndOpenPoi = useCallback(
		(target: { id: string; lat: number; lng: number }) => {
			const targetZoom = Math.max(map.getZoom(), CLUSTER_MAX_ZOOM + 1);
			map.flyTo([target.lat, target.lng], targetZoom, { duration: 0.6 });
			map.once('moveend', () => {
				// Let marker re-render finish after the zoom before polling.
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						let attempts = 0;
						const tick = (): void => {
							attempts += 1;
							const marker = markerByIdRef.current.get(target.id);
							if (marker) {
								marker.openPopup();
							} else if (attempts < DEEPLINK_MAX_POLL_ATTEMPTS) {
								window.setTimeout(tick, DEEPLINK_POLL_INTERVAL_MS);
							}
						};
						tick();
					});
				});
			});
		},
		[map],
	);

	// Consume `?poi=<id>` once per page load (including after a `/s/{code}` redirect).
	useEffect(() => {
		if (deepLinkAppliedRef.current) return;
		if (!poisFile) return;
		const params = getInitialShareUrlParams();
		const targetId = params?.poi;
		if (!targetId) return;
		// Mark applied unconditionally so a missing id is also a one-shot - we
		// don't want the effect to keep re-evaluating on zoom-triggered renders.
		deepLinkAppliedRef.current = true;
		const target = poiById.get(targetId);
		if (target) {
			preparePoiDeepLink(target);
			requestOpenPoi(targetId);
		}
		clearShareUrlParams();
		router.replace(pathname);
	}, [poisFile, poiById, requestOpenPoi, pathname, router]);

	// In-app requests (e.g. clicking a POI in the stage planner list or the
	// up-next strip) set `pendingOpenPoiId` in the store; mirror the deep-link
	// fly+open dance then clear the field so subsequent requests retrigger
	// correctly. Share deep links wait for GPX so TrailRoute fitBounds does
	// not zoom back out over the whole trail after the POI fly.
	useEffect(() => {
		if (!pendingOpenPoiId || !poisFile) return;
		const target = poiById.get(pendingOpenPoiId);
		if (!target) {
			clearPendingOpenPoi();
			return;
		}
		const sharePoiId = getInitialShareUrlParams()?.poi;
		if (sharePoiId === pendingOpenPoiId && !gpxLoaded) return;
		if (!visiblePois.some((poi) => poi.id === pendingOpenPoiId)) return;
		clearPendingOpenPoi();
		flyAndOpenPoi(target);
	}, [pendingOpenPoiId, poisFile, poiById, visiblePois, gpxLoaded, flyAndOpenPoi, clearPendingOpenPoi]);

	return null;
}

/**
 * After a popup opens, fetch the Wikipedia summary for the POI and replace
 * the placeholder paragraph with the truncated extract + a source link.
 * Silent no-op on fetch failure (the placeholder simply hides itself when
 * the fetch returns null).
 */
async function hydrateWikipediaSnippet(marker: L.Marker, poi: Poi, sourceLabel: string): Promise<void> {
	if (!poi.wikipedia) return;
	const popup = marker.getPopup();
	if (!popup) return;
	const summary = await fetchWikipediaSummary(poi.wikipedia);
	// Popup may have closed between fetch start and resolution; nothing to do.
	const el = popup.getElement();
	if (!el) return;
	const placeholder = el.querySelector(`[data-poi-wiki="${cssEscape(poi.id)}"]`);
	if (!placeholder) return;
	if (!summary) {
		placeholder.remove();
		return;
	}
	const extract = truncateExtract(summary.extract);
	const safeUrl = isSafeUrl(summary.url) ? summary.url : '';
	// Build content with DOM APIs to make injection structurally impossible
	// regardless of what fields are added in future.
	const textNode = document.createTextNode(extract);
	const children: Node[] = [textNode];
	if (safeUrl) {
		const spacer = document.createTextNode(' ');
		const link = document.createElement('a');
		link.href = safeUrl;
		link.rel = 'noopener noreferrer';
		link.target = '_blank';
		link.className = 'underline';
		link.appendChild(document.createTextNode(sourceLabel));
		children.push(spacer, link);
	}
	placeholder.replaceChildren(...children);

	// If the dataset didn't carry an image and Wikipedia returned a thumbnail,
	// inject it ahead of the meta rows so the popup gets a visual anchor. We
	// only do this when there's no pre-existing gallery/image to avoid
	// stacking two images on top of each other.
	const hasBakedImage = (poi.images && poi.images.length > 0) || !!poi.image;
	if (!hasBakedImage && summary.thumbnailUrl && isSafeUrl(summary.thumbnailUrl)) {
		const wrapper = el.querySelector<HTMLElement>('.leaflet-popup-content');
		if (wrapper && !wrapper.querySelector('.poi-popup__image--wiki')) {
			const img = document.createElement('img');
			img.className = 'poi-popup__image poi-popup__image--wiki';
			img.src = summary.thumbnailUrl;
			img.alt = summary.title;
			img.loading = 'lazy';
			// Place above the title (first child of the content wrapper).
			wrapper.insertBefore(img, wrapper.firstChild);
		}
	}

	// Leaflet sizes popups at bind time; ask it to recompute now that we
	// added content so it doesn't end up scrollable / cut off.
	popup.update();
}

/** Escapes a string for safe use in a CSS attribute selector. Uses the
 *  platform's CSS.escape when available (all modern browsers), falling back
 *  to a type-cast for environments where lib.dom doesn't expose the typing. */
function cssEscape(s: string): string {
	// CSS.escape handles all special characters including ], ^, $, *, ~, |,
	// whitespace, and anything else that would break an attribute selector.
	return (CSS as { escape: (v: string) => string }).escape(s);
}

/**
 * Wires the "Open in Maps" button inside an open POI popup. Click hands the
 * POI's coordinates to the shared `openCoordinatesInMaps` helper, which uses
 * `geo:` on mobile (Apple Maps / Google Maps / OsmAnd / whatever the user
 * has set as default) and Google Maps in a new tab on desktop. Same affordance
 * as the trail-click tooltip's coordinate link, so behaviour stays consistent.
 */
function wireOpenInMapsButton(marker: L.Marker, poi: Poi): void {
	const popup = marker.getPopup();
	if (!popup) return;
	const el = popup.getElement();
	if (!el) return;
	const btn = el.querySelector<HTMLButtonElement>(`[data-poi-open-maps="${cssEscape(poi.id)}"]`);
	if (!btn) return;
	if (btn.dataset.wired === '1') return;
	btn.dataset.wired = '1';
	btn.addEventListener('click', (e) => {
		e.preventDefault();
		openCoordinatesInMaps(poi.lat, poi.lng);
	});
}

/**
 * Wires the star toggle inside an open POI popup. Calls `toggleStarredPoi`
 * in the store, then re-syncs the button glyph and aria state.
 */
function wireStarButton(marker: L.Marker, poi: Poi, labels: { starAddLabel: string; starRemoveLabel: string }): void {
	const popup = marker.getPopup();
	if (!popup) return;
	const el = popup.getElement();
	if (!el) return;
	const btn = el.querySelector<HTMLButtonElement>(`[data-poi-star="${cssEscape(poi.id)}"]`);
	if (!btn) return;
	if (btn.dataset.wired === '1') return;
	btn.dataset.wired = '1';
	const sync = (starred: boolean): void => {
		btn.textContent = starred ? '★' : '☆';
		btn.setAttribute('aria-pressed', starred ? 'true' : 'false');
		const aria = starred ? labels.starRemoveLabel : labels.starAddLabel;
		btn.setAttribute('aria-label', aria);
		btn.setAttribute('title', aria);
		btn.classList.toggle('poi-popup__star--active', starred);
	};
	sync(useMapStore.getState().starredPoiIds.has(poi.id));
	btn.addEventListener('click', (e) => {
		e.preventDefault();
		useMapStore.getState().toggleStarredPoi(poi.id);
		sync(useMapStore.getState().starredPoiIds.has(poi.id));
	});
}

/** Wires the share button inside an open POI popup (see share-link-copy). */
function wireShareButton(marker: L.Marker, poi: Poi, shareLinkLabel: string): void {
	const popup = marker.getPopup();
	if (!popup) return;
	const el = popup.getElement();
	if (!el) return;
	const btn = el.querySelector<HTMLButtonElement>(`[data-poi-share="${cssEscape(poi.id)}"]`);
	if (!btn) return;
	wirePopupShareButton(btn, () => buildPoiShareUrl(poi.id), shareLinkLabel);
}

function wireAddAsWaypointButton(marker: L.Marker, poi: Poi, displayName: string): void {
	const popup = marker.getPopup();
	if (!popup) return;
	const el = popup.getElement();
	if (!el) return;
	const btn = el.querySelector<HTMLButtonElement>(`[data-poi-add-waypoint="${cssEscape(poi.id)}"]`);
	if (!btn) return;
	if (btn.dataset.wired === '1') return;
	btn.dataset.wired = '1';
	btn.addEventListener('click', (e) => {
		e.preventDefault();
		const state = useMapStore.getState();
		const category = poiTypeToSuggestedWaypointCategory(poi.type);
		const id = newId();
		state.addUserWaypoint({
			id,
			lat: poi.lat,
			lng: poi.lng,
			name: displayName,
			note: '',
			category,
			createdAt: new Date().toISOString(),
			trailKm: poi.trailKm,
		});
		state.requestOpenWaypoint(id);
		marker.closePopup();
	});
}

/**
 * Wires every gallery thumbnail in an open POI popup to open the lightbox
 * at the clicked index. No-op when the popup has no gallery (legacy POIs
 * that only carry the single `image` field, or POIs with no images at all).
 */
function wireGalleryButtons(
	marker: L.Marker,
	poi: Poi,
	onOpen: (images: NonNullable<Poi['images']>, index: number) => void,
): void {
	if (!poi.images || poi.images.length === 0) return;
	const popup = marker.getPopup();
	if (!popup) return;
	const el = popup.getElement();
	if (!el) return;
	const gallery = el.querySelector<HTMLElement>(`[data-poi-gallery-id="${cssEscape(poi.id)}"]`);
	if (!gallery || gallery.dataset.wired === '1') return;
	gallery.dataset.wired = '1';
	const buttons = gallery.querySelectorAll<HTMLButtonElement>('[data-gallery-index]');
	buttons.forEach((btn) => {
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			const raw = btn.getAttribute('data-gallery-index');
			const idx = raw ? parseInt(raw, 10) : 0;
			onOpen(poi.images ?? [], Number.isFinite(idx) ? idx : 0);
		});
	});
}
