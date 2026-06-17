'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useMapStore, useStore, type MapStoreState } from '@/lib/store';
import { newId, nextWaypointName, type UserWaypoint } from '@/lib/user-waypoints';
import { buildWaypointShareUrl, clearShareUrlParams, formatDistance, getInitialShareUrlParams } from '@/lib/utils';
import { wirePopupShareButton } from '@/lib/share-link-copy';
import { formatIsoDate } from '@/lib/date-format';
import { appendWaypointCategoryChips } from '@/lib/waypoint-popup-dom';
import {
	buildWaypointPinHtml,
	isWaypointCategoryVisible,
	normalizeWaypointCategory,
	type WaypointCategoryId,
} from '@/lib/waypoint-categories';

const WAYPOINT_PANE = 'userWaypointPane';

/** Max snap distance when recording a waypoint's trail km; beyond this the
 *  waypoint is simply "off trail" (null km), not an error. */
const SNAP_MAX_M = 2000;

/** Teardrop pin coloured by waypoint category (distinct from POI markers). */
function buildWaypointIcon(category: WaypointCategoryId | undefined): L.DivIcon {
	return L.divIcon({
		className: '',
		html: buildWaypointPinHtml(category),
		iconSize: [18, 18],
		iconAnchor: [9, 18],
		popupAnchor: [0, -18],
	});
}

/**
 * Personal waypoint layer: long-press (mobile) or right-click (desktop) on
 * the map drops a waypoint and opens its popup for naming. Popups edit in
 * place - name input, note textarea, save, and delete - built with DOM APIs
 * so user text can never be interpreted as markup. The progress panel's
 * waypoint list opens popups through `pendingOpenWaypointId`, mirroring the
 * POI deep-link mechanism.
 */
export function UserWaypointMarkers(): null {
	const map = useMap();
	const router = useRouter();
	const pathname = usePathname();
	const t = useTranslations('waypoints');
	const tPois = useTranslations('pois');
	const locale = useLocale();
	const userWaypoints = useMapStore((s: MapStoreState) => s.userWaypoints);
	const hiddenWaypointCategories = useMapStore((s: MapStoreState) => s.hiddenWaypointCategories);
	const updateUserWaypoint = useMapStore((s: MapStoreState) => s.updateUserWaypoint);
	const removeUserWaypoint = useMapStore((s: MapStoreState) => s.removeUserWaypoint);
	const pendingOpenWaypointId = useMapStore((s: MapStoreState) => s.pendingOpenWaypointId);
	const requestOpenWaypoint = useMapStore((s: MapStoreState) => s.requestOpenWaypoint);
	const clearPendingOpenWaypoint = useMapStore((s: MapStoreState) => s.clearPendingOpenWaypoint);
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);

	const markersRef = useRef<Map<string, L.Marker>>(new Map());
	const deepLinkAppliedRef = useRef(false);

	useEffect(() => {
		if (!map.getPane(WAYPOINT_PANE)) {
			map.createPane(WAYPOINT_PANE);
			map.getPane(WAYPOINT_PANE)?.classList.add('user-waypoint-pane');
		}
	}, [map]);

	useEffect(() => {
		const onContextMenu = (e: L.LeafletMouseEvent): void => {
			const target = e.originalEvent.target as HTMLElement | null;
			if (target?.closest('.leaflet-marker-icon, .leaflet-popup, .leaflet-control')) return;
			e.originalEvent.preventDefault();
			const state = useMapStore.getState();
			const snapped = useStore.getState().findTrailPointByCoordinates(e.latlng.lat, e.latlng.lng, SNAP_MAX_M);
			const wp: UserWaypoint = {
				id: newId(),
				lat: e.latlng.lat,
				lng: e.latlng.lng,
				name: nextWaypointName(state.userWaypoints, t('defaultName')),
				note: '',
				category: state.lastWaypointCategory,
				createdAt: new Date().toISOString(),
				trailKm: snapped ? snapped.distanceFromStart / 1000 : null,
			};
			state.addUserWaypoint(wp);
			state.requestOpenWaypoint(wp.id);
		};
		map.on('contextmenu', onContextMenu);
		return () => {
			map.off('contextmenu', onContextMenu);
		};
	}, [map, t]);

	useEffect(() => {
		if (deepLinkAppliedRef.current) return;
		const params = getInitialShareUrlParams();
		const targetId = params?.wp;
		if (!targetId) return;
		deepLinkAppliedRef.current = true;
		if (userWaypoints.some((wp) => wp.id === targetId)) {
			requestOpenWaypoint(targetId);
		}
		clearShareUrlParams();
		router.replace(pathname);
	}, [userWaypoints, requestOpenWaypoint, pathname, router]);

	useEffect(() => {
		const markers = markersRef.current;
		for (const m of markers.values()) m.remove();
		markers.clear();

		const categoryLabel = (id: WaypointCategoryId): string => t(`category.${id}`);

		for (const wp of userWaypoints) {
			const category = normalizeWaypointCategory(wp.category);
			if (!isWaypointCategoryVisible(category, hiddenWaypointCategories)) continue;

			const marker = L.marker([wp.lat, wp.lng], {
				icon: buildWaypointIcon(category),
				pane: WAYPOINT_PANE,
				title: `${wp.name} (${categoryLabel(category)})`,
				alt: wp.name,
			});
			marker.bindPopup(() => buildWaypointPopup(wp), { className: 'poi-popup', maxWidth: 300 });
			marker.on('popupopen', () => {
				wireWaypointShareButton(marker, wp, tPois('shareLink'));
			});
			marker.addTo(map);
			markers.set(wp.id, marker);
		}

		function buildWaypointPopup(wp: UserWaypoint): HTMLElement {
			const category = normalizeWaypointCategory(wp.category);
			const root = document.createElement('div');
			root.style.minWidth = '220px';
			root.style.paddingTop = '14px';

			const nameInput = document.createElement('input');
			nameInput.type = 'text';
			nameInput.value = wp.name;
			nameInput.maxLength = 80;
			nameInput.setAttribute('aria-label', t('nameLabel'));
			nameInput.className = 'poi-popup__input poi-popup__input--title';

			const chipsHost = document.createElement('div');
			const chipPicker = appendWaypointCategoryChips(chipsHost, category, t('categoryLabel'), categoryLabel);

			const noteArea = document.createElement('textarea');
			noteArea.value = wp.note;
			noteArea.rows = 4;
			noteArea.maxLength = 2000;
			noteArea.placeholder = t('notePlaceholder');
			noteArea.setAttribute('aria-label', t('noteLabel'));
			noteArea.className = 'poi-popup__input';

			const metaLine = document.createElement('p');
			metaLine.className = 'poi-popup__row poi-popup__row--muted';
			const kmText =
				wp.trailKm !== null
					? t('atKm', { distance: formatDistance(wp.trailKm, units, distancePrecision) })
					: t('offTrail');
			metaLine.textContent = `${kmText} · ${formatIsoDate(wp.createdAt.slice(0, 10), locale)}`;

			const buttonRow = document.createElement('div');
			buttonRow.className = 'poi-popup__actions';

			const deleteBtn = document.createElement('button');
			deleteBtn.type = 'button';
			deleteBtn.textContent = t('delete');
			deleteBtn.className = 'poi-popup__share';
			deleteBtn.style.cssText = 'color:var(--cldt-red,#dc2626);border-color:var(--cldt-red,#dc2626);';
			deleteBtn.addEventListener('click', () => {
				removeUserWaypoint(wp.id);
			});

			const saveBtn = document.createElement('button');
			saveBtn.type = 'button';
			saveBtn.textContent = t('save');
			saveBtn.className = 'poi-popup__open-maps';
			saveBtn.addEventListener('click', () => {
				updateUserWaypoint(wp.id, {
					name: nameInput.value.trim() || wp.name,
					note: noteArea.value,
					category: chipPicker.getSelected(),
				});
				markers.get(wp.id)?.closePopup();
			});

			const shareBtn = document.createElement('button');
			shareBtn.type = 'button';
			shareBtn.textContent = tPois('shareLink');
			shareBtn.className = 'poi-popup__share';
			shareBtn.dataset.waypointShare = wp.id;

			const navBtn = document.createElement('button');
			navBtn.type = 'button';
			navBtn.textContent = tPois('navigateHere');
			navBtn.className = 'poi-popup__share poi-popup__nav-target';
			navBtn.addEventListener('click', () => {
				useMapStore.getState().setNavTarget({
					id: wp.id,
					lat: wp.lat,
					lng: wp.lng,
					name: nameInput.value.trim() || wp.name,
					source: 'waypoint',
				});
				markers.get(wp.id)?.closePopup();
			});

			buttonRow.append(deleteBtn, saveBtn, shareBtn, navBtn);
			root.append(nameInput, chipsHost, noteArea, metaLine, buttonRow);
			return root;
		}

		return () => {
			for (const m of markers.values()) m.remove();
			markers.clear();
		};
	}, [
		map,
		userWaypoints,
		hiddenWaypointCategories,
		units,
		distancePrecision,
		t,
		tPois,
		locale,
		updateUserWaypoint,
		removeUserWaypoint,
	]);

	useEffect(() => {
		if (!pendingOpenWaypointId) return;
		const marker = markersRef.current.get(pendingOpenWaypointId);
		if (!marker) return;
		clearPendingOpenWaypoint();
		const target = marker.getLatLng();
		if (!map.getBounds().contains(target)) {
			map.flyTo(target, Math.max(map.getZoom(), 13));
		}
		marker.openPopup();
	}, [pendingOpenWaypointId, userWaypoints, hiddenWaypointCategories, map, clearPendingOpenWaypoint]);

	return null;
}

function wireWaypointShareButton(marker: L.Marker, wp: UserWaypoint, shareLinkLabel: string): void {
	const popup = marker.getPopup();
	if (!popup) return;
	const el = popup.getElement();
	if (!el) return;
	const btn = el.querySelector<HTMLButtonElement>(`[data-waypoint-share="${cssEscape(wp.id)}"]`);
	if (!btn) return;
	wirePopupShareButton(btn, () => buildWaypointShareUrl(wp.id), shareLinkLabel);
}

function cssEscape(value: string): string {
	if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
		return CSS.escape(value);
	}
	return value.replace(/["\\]/g, '\\$&');
}
