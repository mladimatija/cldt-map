'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useTranslations } from 'next-intl';
import { useMapStore, useStore, type MapStoreState } from '@/lib/store';
import { newId, nextWaypointName, type UserWaypoint } from '@/lib/user-waypoints';
import { formatDistance } from '@/lib/utils';

const WAYPOINT_PANE = 'userWaypointPane';

/** Max snap distance when recording a waypoint's trail km; beyond this the
 *  waypoint is simply "off trail" (null km), not an error. */
const SNAP_MAX_M = 2000;

/** Violet pin, visually distinct from every POI category and the location
 *  marker. Inline-styled so the layer needs no global CSS. */
function buildWaypointIcon(): L.DivIcon {
	return L.divIcon({
		className: '',
		html:
			'<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);' +
			'background:#7c3aed;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);" ' +
			'aria-hidden="true"></div>',
		iconSize: [18, 18],
		iconAnchor: [9, 18],
		popupAnchor: [0, -18],
	});
}

/**
 * Personal waypoint layer: long-press (mobile) or right-click (desktop) on
 * the map drops a waypoint and opens its popup for naming. Popups edit in
 * place - name input, note textarea, save and delete - built with DOM APIs
 * so user text can never be interpreted as markup. The progress panel's
 * waypoint list opens popups through `pendingOpenWaypointId`, mirroring the
 * POI deep-link mechanism.
 */
export function UserWaypointMarkers(): null {
	const map = useMap();
	const t = useTranslations('waypoints');
	const userWaypoints = useMapStore((s: MapStoreState) => s.userWaypoints);
	const updateUserWaypoint = useMapStore((s: MapStoreState) => s.updateUserWaypoint);
	const removeUserWaypoint = useMapStore((s: MapStoreState) => s.removeUserWaypoint);
	const pendingOpenWaypointId = useMapStore((s: MapStoreState) => s.pendingOpenWaypointId);
	const clearPendingOpenWaypoint = useMapStore((s: MapStoreState) => s.clearPendingOpenWaypoint);
	const units = useMapStore((s: MapStoreState) => s.units);
	const distancePrecision = useMapStore((s: MapStoreState) => s.distancePrecision);

	const markersRef = useRef<Map<string, L.Marker>>(new Map());

	// Dedicated pane just above the POI markers so personal pins are never
	// buried under clusters; created once, DOM-ordered after markerPane.
	useEffect(() => {
		if (!map.getPane(WAYPOINT_PANE)) {
			map.createPane(WAYPOINT_PANE);
		}
	}, [map]);

	// Drop a waypoint on contextmenu (right-click / long-press). Ignores
	// events originating on markers, popups, or controls.
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

	// Render markers; full rebuild on collection/unit changes (the list is
	// small - personal annotations, not a dataset).
	useEffect(() => {
		const markers = markersRef.current;
		for (const m of markers.values()) m.remove();
		markers.clear();

		for (const wp of userWaypoints) {
			const marker = L.marker([wp.lat, wp.lng], {
				icon: buildWaypointIcon(),
				pane: WAYPOINT_PANE,
				title: wp.name,
				alt: wp.name,
			});
			marker.bindPopup(() => buildWaypointPopup(wp), { className: 'map-tooltip', maxWidth: 260 });
			marker.addTo(map);
			markers.set(wp.id, marker);
		}

		function buildWaypointPopup(wp: UserWaypoint): HTMLElement {
			const root = document.createElement('div');
			root.style.minWidth = '200px';

			const nameInput = document.createElement('input');
			nameInput.type = 'text';
			nameInput.value = wp.name;
			nameInput.maxLength = 80;
			nameInput.setAttribute('aria-label', t('nameLabel'));
			nameInput.style.cssText = 'width:100%;font-weight:600;margin-bottom:4px;';

			const noteArea = document.createElement('textarea');
			noteArea.value = wp.note;
			noteArea.rows = 3;
			noteArea.maxLength = 2000;
			noteArea.placeholder = t('notePlaceholder');
			noteArea.setAttribute('aria-label', t('noteLabel'));
			noteArea.style.cssText = 'width:100%;font-size:12px;margin-bottom:4px;resize:vertical;';

			const metaLine = document.createElement('p');
			metaLine.style.cssText = 'margin:0 0 6px;font-size:11px;opacity:0.7;';
			const kmText =
				wp.trailKm !== null
					? t('atKm', { distance: formatDistance(wp.trailKm, units, distancePrecision) })
					: t('offTrail');
			metaLine.textContent = `${kmText} · ${wp.createdAt.slice(0, 10)}`;

			const buttonRow = document.createElement('div');
			buttonRow.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;';

			const saveBtn = document.createElement('button');
			saveBtn.type = 'button';
			saveBtn.textContent = t('save');
			saveBtn.style.cssText = 'font-size:12px;padding:2px 10px;cursor:pointer;';
			saveBtn.addEventListener('click', () => {
				updateUserWaypoint(wp.id, { name: nameInput.value.trim() || wp.name, note: noteArea.value });
				markers.get(wp.id)?.closePopup();
			});

			const deleteBtn = document.createElement('button');
			deleteBtn.type = 'button';
			deleteBtn.textContent = t('delete');
			deleteBtn.style.cssText = 'font-size:12px;padding:2px 10px;cursor:pointer;color:#dc2626;';
			deleteBtn.addEventListener('click', () => {
				removeUserWaypoint(wp.id);
			});

			buttonRow.append(deleteBtn, saveBtn);
			root.append(nameInput, noteArea, metaLine, buttonRow);
			return root;
		}

		return () => {
			for (const m of markers.values()) m.remove();
			markers.clear();
		};
	}, [map, userWaypoints, units, distancePrecision, t, updateUserWaypoint, removeUserWaypoint]);

	// Panel-initiated open (and the just-created flow): fly to the waypoint
	// and open its popup once the marker exists.
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
	}, [pendingOpenWaypointId, userWaypoints, map, clearPendingOpenWaypoint]);

	return null;
}
