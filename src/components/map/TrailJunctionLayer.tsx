'use client';

/**
 * Marked-trail junction data-book overlay: one decluttered chip marker on the
 * CLDT polyline for every OSM route relation (route=hiking/foot) that branches
 * off the trail, coloured by its osmc:symbol waymark colour. Click a chip for a
 * popup with the marked trail's OSM name / ref / network.
 *
 * TEMPER FRAMING: each chip is "the marked trail that branches off here", keyed
 * on OpenStreetMap tags - NOT an authoritative HPS Registar lookup (HPS route
 * numbers are unreliable in OSM). The popup provenance line credits OSM.
 *
 * Headless: returns null and manages Leaflet layers imperatively. Renders
 * nothing while the bundled dataset is empty, so the whole feature stays dormant
 * until real junction data is enriched and committed.
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { useLocale, useTranslations } from 'next-intl';
import { useMapStore, useStore, type MapStoreState, type StoreState } from '@/lib/store';
import { hasTrailJunctions, junctionColor, junctionLabel, type TrailJunction } from '@/lib/trail-junctions';
import { findNearestPointIndex } from '@/lib/distance-utils';

/** Minimum pixel gap between two chips before the later one is dropped at the
 *  current zoom, so a dense cluster of junctions never stacks into an
 *  unreadable pile. Recomputed on every zoom/pan. */
const DECLUTTER_PX = 26;

/** Y-fork glyph - reads as a branching trail. */
const JUNCTION_GLYPH =
	'<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
	'<path d="M6 11 V6 M6 6 L3 2 M6 6 L9 2"/>' +
	'</svg>';

/** Picks a readable glyph stroke colour (near-black or white) for a chip
 *  background, so a white / yellow waymark chip keeps a dark glyph and a red /
 *  blue chip keeps a white one. Falls back to white for non-hex colours. */
function contrastStroke(bgHex: string): string {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(bgHex.trim());
	if (!m) return '#ffffff';
	// Normalize short-form hex to 6 digits and drop any alpha byte first, so a
	// short colour (e.g. #ff0) picks the same glyph as its full-length or named
	// equivalent rather than falling through to the white default.
	const hex = m[1];
	const rgb = hex.length <= 4 ? hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] : hex.slice(0, 6);
	const n = parseInt(rgb, 16);
	const r = (n >> 16) & 0xff;
	const g = (n >> 8) & 0xff;
	const b = n & 0xff;
	// Rec. 601 luma; > 150 is a light background.
	const luma = 0.299 * r + 0.587 * g + 0.114 * b;
	return luma > 150 ? '#1f2937' : '#ffffff';
}

function escapeHtmlAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildChipIcon(color: string, ariaLabel: string): L.DivIcon {
	const stroke = contrastStroke(color);
	const html =
		`<span class="trail-junction-chip" role="img" aria-label="${escapeHtmlAttr(ariaLabel)}" ` +
		`style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;` +
		`border-radius:9999px;background:${color};color:${stroke};stroke:${stroke};` +
		`box-shadow:0 0 0 2px #fff,0 1px 3px rgba(0,0,0,0.45);">${JUNCTION_GLYPH}</span>`;
	return L.divIcon({
		className: 'trail-junction-chip-wrapper',
		html,
		iconSize: [20, 20],
		iconAnchor: [10, 10],
	});
}

interface PopupStrings {
	title: string;
	branchesOff: string;
	provenance: string;
	ref?: string;
	network?: string;
}

function buildPopupContent(strings: PopupStrings): HTMLElement {
	const container = document.createElement('div');
	container.className = 'map-tooltip trail-junction-popup';

	const title = document.createElement('strong');
	title.textContent = strings.title;
	container.appendChild(title);

	if (strings.ref) {
		const refEl = document.createElement('div');
		refEl.textContent = strings.ref;
		container.appendChild(refEl);
	}
	if (strings.network) {
		const networkEl = document.createElement('div');
		networkEl.textContent = strings.network;
		container.appendChild(networkEl);
	}

	const branches = document.createElement('p');
	branches.className = 'trail-junction-popup__temper';
	branches.textContent = strings.branchesOff;
	container.appendChild(branches);

	const provenance = document.createElement('div');
	provenance.className = 'trail-junction-popup__provenance';
	provenance.textContent = strings.provenance;
	container.appendChild(provenance);

	return container;
}

interface PlacedJunction {
	junction: TrailJunction;
	lat: number;
	lng: number;
	color: string;
}

export function TrailJunctionLayer(): null {
	const map = useMap();
	const t = useTranslations('trailJunctions');
	const locale = useLocale();
	const tRef = useRef(t);
	useEffect(() => {
		tRef.current = t;
	}, [t]);

	const enabled = useMapStore((s: MapStoreState) => s.showTrailJunctions);
	const file = useMapStore((s: MapStoreState) => s.trailJunctionsFile);
	const enhancedTrailPoints = useStore((s: StoreState) => s.enhancedTrailPoints);

	const groupRef = useRef<L.LayerGroup | null>(null);

	useEffect(() => {
		const removeGroup = (): void => {
			if (groupRef.current) {
				map.removeLayer(groupRef.current);
				groupRef.current = null;
			}
		};
		if (!enabled || !hasTrailJunctions(file) || enhancedTrailPoints.length === 0) {
			removeGroup();
			return;
		}

		// Snap each junction to its nearest trail point once; the chip position is
		// zoom-independent, only the declutter decision changes with zoom.
		const placed: PlacedJunction[] = [];
		for (const junction of file.junctions) {
			const idx = findNearestPointIndex(enhancedTrailPoints, junction.trailKm * 1000);
			const pt = enhancedTrailPoints[idx];
			if (pt) placed.push({ junction, lat: pt.lat, lng: pt.lng, color: junctionColor(junction) });
		}

		const buildPopupStrings = (junction: TrailJunction): PopupStrings => ({
			title: junctionLabel(junction, tRef.current('layerLabel')),
			branchesOff: tRef.current('branchesOff'),
			provenance: tRef.current('provenance'),
			ref: junction.ref ? tRef.current('popupRef', { ref: junction.ref }) : undefined,
			network: junction.network ? tRef.current('popupNetwork', { network: junction.network }) : undefined,
		});

		const render = (): void => {
			removeGroup();
			const group = L.layerGroup();
			const shown: L.Point[] = [];
			for (const p of placed) {
				const cp = map.latLngToContainerPoint([p.lat, p.lng]);
				if (shown.some((s) => cp.distanceTo(s) < DECLUTTER_PX)) continue;
				shown.push(cp);
				// name / ref precedence in one place; empty fallback keeps the bare
				// layer label when the junction has neither a name nor a ref.
				const named = junctionLabel(p.junction, '');
				const label = named ? `${tRef.current('layerLabel')}: ${named}` : tRef.current('layerLabel');
				const marker = L.marker([p.lat, p.lng], {
					icon: buildChipIcon(p.color, label),
					keyboard: false,
					riseOnHover: true,
				});
				const junction = p.junction;
				marker.on('click', (e: L.LeafletMouseEvent) => {
					L.DomEvent.stopPropagation(e);
					L.popup({ className: 'trail-junction-leaflet-popup', offset: [0, -8] })
						.setLatLng([p.lat, p.lng])
						.setContent(buildPopupContent(buildPopupStrings(junction)))
						.openOn(map);
				});
				group.addLayer(marker);
			}
			group.addTo(map);
			groupRef.current = group;
		};

		render();
		// Only zoom changes the declutter outcome: it uses pairwise container-point
		// gaps, which are translation-invariant, and every junction is considered
		// regardless of viewport (no bounds culling), so a pan never adds or drops a
		// chip. Leaflet repositions the latlng-anchored markers on pan on its own.
		map.on('zoomend', render);
		return () => {
			map.off('zoomend', render);
			removeGroup();
		};
	}, [map, enabled, file, enhancedTrailPoints, locale]);

	return null;
}
