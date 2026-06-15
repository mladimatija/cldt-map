import { BaseMapProvider } from '@/lib/services/base-map-provider';
import type { EnhancedTrailPoint, StagePlan, TrailDirection, UnitSystem } from '@/lib/store/types';
import { computeStageStats } from '@/lib/stage-planner';
import { findNearestPointIndex, formatEta } from '@/lib/distance-utils';
import { formatElevation, kmToMiles } from '@/lib/utils';
import { siteMetadata } from '@/lib/metadata';

/** Providers whose tile servers don't send Access-Control-Allow-Origin; PNG canvas export will taint. */
const CORS_BLOCKED_PROVIDERS: string[] = [BaseMapProvider.SATELLITE, BaseMapProvider.CROATIA_TOPO];

export const MAP_RENDER_SETTLE_MS = 600;

/** Returns true if PNG export should be disabled for the given base map provider. */
export function isPngExportDisabled(provider: string): boolean {
	return CORS_BLOCKED_PROVIDERS.includes(provider);
}

/**
 * Returns the reason why PNG export is disabled for the provider,
 * or an empty string if export is allowed.
 */
export function getExportDisabledReason(provider: string): string {
	if (isPngExportDisabled(provider)) {
		return 'PNG export is unavailable for this map style due to tile server CORS restrictions.';
	}
	return '';
}

interface RulerRange {
	distanceFromStartA: number;
	distanceFromStartB: number;
}

interface PointWithDistance {
	lat: number;
	lng: number;
	distanceFromStart: number;
}

export interface LeafletMapForExport {
	fitBounds: (bounds: [[number, number], [number, number]], options?: object) => void;
	getCenter: () => { lat: number; lng: number };
	getZoom: () => number;
	setView: (center: { lat: number; lng: number }, zoom: number) => void;
	invalidateSize: (opts?: object) => void;
}

export function pointsToBounds(pts: { lat: number; lng: number }[]): [[number, number], [number, number]] {
	if (pts.length === 0) throw new Error('pointsToBounds requires at least one point');
	let minLat = pts[0].lat,
		maxLat = pts[0].lat,
		minLng = pts[0].lng,
		maxLng = pts[0].lng;
	for (const p of pts) {
		if (p.lat < minLat) minLat = p.lat;
		if (p.lat > maxLat) maxLat = p.lat;
		if (p.lng < minLng) minLng = p.lng;
		if (p.lng > maxLng) maxLng = p.lng;
	}
	return [
		[minLat, minLng],
		[maxLat, maxLng],
	];
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

const EXCLUDED_PANE_CLASSES = new Set([
	'leaflet-marker-pane',
	'leaflet-shadow-pane',
	'leaflet-tooltip-pane',
	'leaflet-popup-pane',
]);

export function makeCaptureFilter(container: HTMLElement): (node: Element) => boolean {
	return (node: Element): boolean => {
		if (node === container) return true;
		// html-to-image walks every child node including Text/Comment which
		// have no classList; keep those and skip the class-based checks.
		if (!(node instanceof Element)) return true;
		// Direct children: only keep leaflet-map-pane
		if (node.parentElement === container) return node.classList.contains('leaflet-map-pane');
		// Within map-pane: exclude marker/shadow/tooltip/popup panes
		for (const cls of EXCLUDED_PANE_CLASSES) {
			if (node.classList.contains(cls)) return false;
		}
		return true;
	};
}

/**
 * Fits the map view to the bounds of the ruler segment.
 * No-op when rulerRange is null or points are empty.
 */
export function fitMapToRulerBounds(
	map: Pick<LeafletMapForExport, 'fitBounds'>,
	rulerRange: RulerRange | null,
	enhancedPoints: PointWithDistance[],
	options?: Record<string, unknown>,
): void {
	if (!rulerRange || enhancedPoints.length === 0) {
		return;
	}

	const { distanceFromStartA, distanceFromStartB } = rulerRange;
	const min = Math.min(distanceFromStartA, distanceFromStartB);
	const max = Math.max(distanceFromStartA, distanceFromStartB);

	const segmentPoints = enhancedPoints.filter((p) => p.distanceFromStart >= min && p.distanceFromStart <= max);

	if (segmentPoints.length === 0) {
		return;
	}

	map.fitBounds(pointsToBounds(segmentPoints), { padding: [40, 40], ...options });
}

/** Minimal Leaflet GridLayer surface used by waitForTilesLoaded. Duck-typed on
 *  `isLoading` (only GridLayer-derived tile layers have it) so this module does
 *  not need to import the Leaflet value (keeps it SSR/bundle-safe). */
interface CaptureTileLayer {
	options?: { pane?: string };
	isLoading: () => boolean;
	on: (type: 'load', fn: (e: { target: CaptureTileLayer }) => void) => void;
	off: (type: 'load', fn: (e: { target: CaptureTileLayer }) => void) => void;
}

/**
 * Resolves once the map's base tile layers have finished loading, so a
 * screenshot is never taken over blank/gray tiles. Only base tiles (default
 * `tilePane`) are tracked; radar/Waymarked overlays in custom panes are
 * ignored. When nothing is loading (cached/offline tiles fire no `load`
 * event) it short-circuits to a settle delay instead of stalling on the
 * timeout ceiling. The post-load settle (default `MAP_RENDER_SETTLE_MS`) also
 * lets the React stage-highlight commit before capture.
 */
export async function waitForTilesLoaded(
	map: LeafletMapForExport,
	timeoutMs = 4000,
	settleMs = MAP_RENDER_SETTLE_MS,
): Promise<void> {
	const layers: CaptureTileLayer[] = [];
	try {
		(map as unknown as { eachLayer: (fn: (layer: unknown) => void) => void }).eachLayer((layer) => {
			const l = layer as Partial<CaptureTileLayer>;
			if (typeof l.isLoading !== 'function') return; // not a tile/grid layer
			const pane = l.options?.pane;
			if (pane === undefined || pane === 'tilePane') layers.push(l as CaptureTileLayer);
		});
	} catch {
		// Map stub without eachLayer: fall back to a plain settle below.
	}

	let loading: CaptureTileLayer[] = [];
	try {
		loading = layers.filter((l) => l.isLoading());
	} catch {
		loading = [];
	}

	if (loading.length === 0) {
		await new Promise<void>((resolve) => setTimeout(resolve, settleMs));
		return;
	}

	await new Promise<void>((resolve) => {
		const remaining = new Set(loading);
		let done = false;
		const onLoad = (e: { target: CaptureTileLayer }): void => {
			remaining.delete(e.target);
			if (remaining.size === 0) finish();
		};
		const finish = (): void => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			loading.forEach((l) => l.off('load', onLoad));
			setTimeout(resolve, settleMs);
		};
		loading.forEach((l) => l.on('load', onLoad));
		const timer = setTimeout(finish, timeoutMs); // ceiling for slow/dead tiles
	});
}

/** Capture the live Leaflet map framed to a stage km window, cropped to aspect. */
export async function captureStageMapSnapshot(
	map: LeafletMapForExport,
	mapEl: HTMLElement,
	enhancedTrailPoints: PointWithDistance[],
	startKm: number,
	endKm: number,
	captureFilter: (node: Element) => boolean,
	toBlob: typeof import('html-to-image').toBlob,
	aspectW: number,
	aspectH: number,
	signal?: AbortSignal,
): Promise<string | null> {
	if (signal?.aborted) return null;
	const startIdx = findNearestPointIndex(enhancedTrailPoints, startKm * 1000);
	const endIdx = findNearestPointIndex(enhancedTrailPoints, endKm * 1000);
	const lo = Math.min(startIdx, endIdx);
	const hi = Math.max(startIdx, endIdx);
	if (hi - lo < 1) return null;
	const pts = enhancedTrailPoints.slice(lo, hi + 1);
	map.fitBounds(pointsToBounds(pts), {
		paddingTopLeft: [40, 40],
		paddingBottomRight: [40, 40],
		animate: false,
	});
	map.invalidateSize({ animate: false });
	// Wait for the repositioned tiles to actually load before snapshotting.
	await waitForTilesLoaded(map);
	if (signal?.aborted) return null;
	const blob = await toBlob(mapEl, { cacheBust: true, filter: captureFilter });
	if (!blob) return null;
	const dataUrl = await blobToDataUrl(blob);
	return cropToAspect(dataUrl, aspectW, aspectH);
}

export async function cropToAspect(dataUrl: string, targetW: number, targetH: number): Promise<string> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => {
			const imgAspect = img.width / img.height;
			const targetAspect = targetW / targetH;
			let sx = 0,
				sy = 0,
				sw = img.width,
				sh = img.height;
			if (imgAspect > targetAspect) {
				sw = Math.round(img.height * targetAspect);
				sx = Math.round((img.width - sw) / 2);
			} else {
				sh = Math.round(img.width / targetAspect);
				sy = Math.round((img.height - sh) / 2);
			}
			const canvas = document.createElement('canvas');
			canvas.width = sw;
			canvas.height = sh;
			canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
			resolve(canvas.toDataURL('image/png'));
		};
		img.src = dataUrl;
	});
}

export async function exportStripMapPdf(
	stagePlan: StagePlan,
	enhancedPoints: EnhancedTrailPoint[],
	elevationPoints: { elevation: number; distanceFromStart: number }[],
	paceKmh: number,
	gradeAdjusted: boolean,
	units: UnitSystem,
	map: LeafletMapForExport,
	onProgress?: (current: number, total: number) => void,
	stageLabel?: string,
	mapEl?: HTMLElement,
	signal?: AbortSignal,
	onStageChange?: (index: number) => void,
	direction?: TrailDirection,
): Promise<void> {
	const { stages } = stagePlan;
	if (!stages.length || !enhancedPoints.length) return;

	const originalCenter = map.getCenter();
	const originalZoom = map.getZoom();

	const [{ jsPDF }, { toBlob }] = await Promise.all([import('jspdf'), import('html-to-image')]);

	const resolvedMapEl = mapEl ?? document.querySelector<HTMLElement>('.leaflet-container');
	if (!resolvedMapEl) throw new Error('leaflet-container not found');

	const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
	// A4 landscape: 297 × 210 mm; 14 mm header band; map image fills remaining 196 mm

	const isImperial = units === 'imperial';
	const allStats = stages.map((stage) =>
		computeStageStats(stage, enhancedPoints, elevationPoints, paceKmh, gradeAdjusted),
	);

	const logoDataUrl = await fetch('/icon-192.png')
		.then((r) => r.blob())
		.then(blobToDataUrl)
		.catch(() => null);

	const captureFilter = makeCaptureFilter(resolvedMapEl);
	// Extra top padding so the trail sits clear of where the PDF header band will appear
	const headerPadPx = Math.round((14 / 210) * resolvedMapEl.offsetHeight) + 40;

	try {
		for (let i = 0; i < stages.length; i++) {
			if (signal?.aborted) return;

			onStageChange?.(i);

			const stage = stages[i];
			const startIdx = findNearestPointIndex(enhancedPoints, stage.startKm * 1000);
			const endIdx = findNearestPointIndex(enhancedPoints, stage.endKm * 1000);
			const lo = Math.min(startIdx, endIdx);
			const hi = Math.max(startIdx, endIdx);

			if (hi - lo >= 1) {
				const pts = enhancedPoints.slice(lo, hi + 1);
				map.fitBounds(pointsToBounds(pts), {
					paddingTopLeft: [40, headerPadPx],
					paddingBottomRight: [40, 40],
					animate: false,
				});
				map.invalidateSize({ animate: false });
			}

			// Wait for tiles to load (and the React highlight to commit during
			// the settle) after the map reposition, before snapshotting.
			await waitForTilesLoaded(map);

			if (signal?.aborted) return;

			const blob = await toBlob(resolvedMapEl, { cacheBust: true, filter: captureFilter });
			let dataUrl = blob ? await blobToDataUrl(blob) : null;
			if (dataUrl) dataUrl = await cropToAspect(dataUrl, 297, 196);

			if (i > 0) pdf.addPage();

			const stats = allStats[i];
			const toDisp = (km: number): string => (isImperial ? kmToMiles(km).toFixed(0) : km.toFixed(0));
			const distKm = stage.endKm - stage.startKm;
			const distDisplay = isImperial ? kmToMiles(distKm).toFixed(1) + ' mi' : distKm.toFixed(1) + ' km';
			const isNobo = direction === 'NOBO';
			const gainStr = formatElevation(isNobo ? stats.lossM : stats.gainM, units);
			const lossStr = formatElevation(isNobo ? stats.gainM : stats.lossM, units);
			const etaStr = formatEta(stats.etaSec);
			const rangeStr = `${toDisp(stage.startKm)}-${toDisp(stage.endKm)} ${isImperial ? 'mi' : 'km'}`;

			// Header band
			pdf.setFillColor(240, 240, 240);
			pdf.rect(0, 0, 297, 14, 'F');

			if (logoDataUrl) {
				pdf.addImage(logoDataUrl, 'PNG', 1, 1, 12, 12);
				pdf.link(1, 1, 12, 12, { url: siteMetadata.companyUrl });
			}

			pdf.setFont('helvetica', 'bold');
			pdf.setFontSize(9);
			pdf.setTextColor(40, 40, 40);
			pdf.text(`${stageLabel ?? 'Stage'} ${i + 1} / ${stages.length}  |  ${rangeStr}  |  ${distDisplay}`, 15, 6);
			pdf.setFont('helvetica', 'normal');
			// gain: green-600 (#16a34a), loss: red-500 (#ef4444), ETA: dark gray
			pdf.setTextColor(22, 163, 74);
			pdf.text(`+${gainStr}`, 15, 11);
			const gainWidth = pdf.getTextWidth(`+${gainStr}`);
			pdf.setTextColor(239, 68, 68);
			pdf.text(`  -${lossStr}`, 15 + gainWidth, 11);
			const lossWidth = pdf.getTextWidth(`  -${lossStr}`);
			pdf.setTextColor(40, 40, 40);
			pdf.text(`  ${etaStr}`, 15 + gainWidth + lossWidth, 11);

			if (dataUrl) {
				pdf.addImage(dataUrl, 'PNG', 0, 14, 297, 196);
			}

			onProgress?.(i + 1, stages.length);
		}
		if (!signal?.aborted) pdf.save('cldt-stages-map.pdf');
	} finally {
		map.setView(originalCenter, originalZoom);
	}
}
