import { DEFAULT_MAP_SERVICES } from '@/lib/services/map-service-config';
import type { EnhancedTrailPoint, StagePlan, TrailDirection, UnitSystem } from '@/lib/store/types';
import { computeStageStats } from '@/lib/stage-planner';
import { toTravelRange } from '@/lib/trail-frame';
import { findNearestPointIndex, formatEta } from '@/lib/distance-utils';
import { formatElevation } from '@/lib/format';
import { formatKm, kmToUnit } from '@/lib/units';
import { siteMetadata } from '@/lib/metadata';
import { boundsOf, toLeafletBounds } from '@/lib/geo-bounds';
import { isBaseTilePane } from '@/lib/leaflet-panes';

const MAP_RENDER_SETTLE_MS = 600;

/** Map pages in the PDF and DOCX exports print at this resolution. */
const PRINT_DPI = 200;
/** JPEG quality for map pages; JPEG keeps map imagery far smaller than PNG. */
const PRINT_JPEG_QUALITY = 0.85;

/** True when PNG export is off for a base map style: its tile server sends no
 *  CORS headers (Croatia Topo), so the capture could not read its tiles. */
export function isPngExportDisabled(provider: string): boolean {
	const service = DEFAULT_MAP_SERVICES.find((s) => s.name === provider) ?? DEFAULT_MAP_SERVICES[0];
	return !service.cors;
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
	const box = boundsOf(pts);
	if (!box) throw new Error('pointsToBounds requires at least one point');
	return toLeafletBounds(box);
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
			if (isBaseTilePane(l.options?.pane)) layers.push(l as CaptureTileLayer);
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

/** A 1x1 transparent GIF, drawn for a tile image the capture cannot fetch. */
const BLANK_IMAGE_URL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

/** False for a canvas the page may not read back (drawn from an image loaded
 *  without CORS). Tested by drawing it into a 1x1 probe, which it would taint,
 *  so any kind of canvas context works. */
function isCanvasReadable(canvas: HTMLCanvasElement): boolean {
	if (canvas.width === 0 || canvas.height === 0) return true;
	const probe = document.createElement('canvas');
	probe.width = probe.height = 1;
	const ctx = probe.getContext('2d');
	if (!ctx) return true;
	try {
		ctx.drawImage(canvas, 0, 0, 1, 1);
		ctx.getImageData(0, 0, 1, 1);
		return true;
	} catch {
		return false;
	}
}

/**
 * Renders the map element to a PNG with html-to-image. Tile images come from
 * the browser and service worker caches, so stored tiles export offline, and a
 * tile image that cannot be fetched is left blank instead of failing the capture.
 *
 * A clipped tile drawn from a copy an earlier version stored without CORS
 * cannot be read back; such tiles are left out. They are drawn that way only
 * offline, or before the updated service worker takes over.
 */
export async function captureMapImage(
	mapEl: HTMLElement,
	toBlob: typeof import('html-to-image').toBlob,
	filter: (node: Element) => boolean = () => true,
	pixelRatio?: number,
): Promise<Blob | null> {
	const unreadable = new Set<Element>([...mapEl.querySelectorAll('canvas')].filter((c) => !isCanvasReadable(c)));
	return toBlob(mapEl, {
		imagePlaceholder: BLANK_IMAGE_URL,
		// WMS tiles share one path and differ only in their query string.
		includeQueryParams: true,
		filter: (node) => !unreadable.has(node) && filter(node),
		pixelRatio,
	});
}

/** The capture pixel ratio at which the part of the map a page shows (cropped
 *  to `widthMm` by `heightMm`) prints at PRINT_DPI: never below 1, and above 1
 *  only up to the screen's own ratio. Captures at the screen's full ratio made
 *  each page of a large screen's PDF about 17 MB. */
function printPixelRatio(mapEl: HTMLElement, widthMm: number, heightMm: number): number {
	const croppedWidth = Math.min(mapEl.clientWidth, (mapEl.clientHeight * widthMm) / heightMm);
	const wantedPixels = (widthMm / 25.4) * PRINT_DPI;
	return Math.max(1, Math.min(window.devicePixelRatio || 1, wantedPixels / croppedWidth));
}

/** The map captured at print resolution and cropped to a page area of `widthMm`
 *  by `heightMm`, as a JPEG data URL; null when the capture gives no image. */
async function capturePrintMap(
	mapEl: HTMLElement,
	toBlob: typeof import('html-to-image').toBlob,
	filter: (node: Element) => boolean,
	widthMm: number,
	heightMm: number,
): Promise<string | null> {
	const blob = await captureMapImage(mapEl, toBlob, filter, printPixelRatio(mapEl, widthMm, heightMm));
	if (!blob) return null;
	return cropToAspect(await blobToDataUrl(blob), widthMm, heightMm);
}

/** Capture the live Leaflet map framed to a stage km window, as a JPEG data URL
 *  cropped to the `widthMm` by `heightMm` it prints at. */
export async function captureStageMapSnapshot(
	map: LeafletMapForExport,
	mapEl: HTMLElement,
	enhancedTrailPoints: PointWithDistance[],
	startKm: number,
	endKm: number,
	captureFilter: (node: Element) => boolean,
	toBlob: typeof import('html-to-image').toBlob,
	widthMm: number,
	heightMm: number,
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
	return capturePrintMap(mapEl, toBlob, captureFilter, widthMm, heightMm);
}

/** Crops a captured map to the page's aspect ratio, as a JPEG data URL; null
 *  when the capture does not decode or is empty, so the page goes without a map. */
async function cropToAspect(dataUrl: string, targetW: number, targetH: number): Promise<string | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onerror = () => resolve(null);
		img.onload = () => {
			if (!img.width || !img.height) {
				resolve(null);
				return;
			}
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
			const ctx = canvas.getContext('2d')!;
			// JPEG has no transparency: anything see-through prints white, not black.
			ctx.fillStyle = '#fff';
			ctx.fillRect(0, 0, sw, sh);
			ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
			resolve(canvas.toDataURL('image/jpeg', PRINT_JPEG_QUALITY));
		};
		img.src = dataUrl;
	});
}

export async function exportStripMapPdf(
	stagePlan: StagePlan,
	enhancedPoints: EnhancedTrailPoint[],
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
	const mapWidthMm = 297;
	const mapHeightMm = 196;

	const isImperial = units === 'imperial';
	// Stages are SOBO ranges; stats and labels follow the hiker's direction.
	const travelDirection = direction ?? 'SOBO';
	const totalKm = enhancedPoints[enhancedPoints.length - 1].distanceFromStart / 1000;
	const allStats = stages.map((stage) =>
		computeStageStats(stage, enhancedPoints, paceKmh, gradeAdjusted, travelDirection),
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

			const dataUrl = await capturePrintMap(resolvedMapEl, toBlob, captureFilter, mapWidthMm, mapHeightMm);

			if (i > 0) pdf.addPage();

			const stats = allStats[i];
			const toDisp = (km: number): string => kmToUnit(km, units).toFixed(0);
			const distKm = stage.endKm - stage.startKm;
			const distDisplay = formatKm(distKm, units, 1);
			const gainStr = formatElevation(stats.gainM, units);
			const lossStr = formatElevation(stats.lossM, units);
			const etaStr = formatEta(stats.etaSec);
			const travel = toTravelRange(stage.startKm, stage.endKm, travelDirection, totalKm);
			const rangeStr = `${toDisp(travel.from)}-${toDisp(travel.to)} ${isImperial ? 'mi' : 'km'}`;

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
				pdf.addImage(dataUrl, 'JPEG', 0, 14, mapWidthMm, mapHeightMm);
			}

			onProgress?.(i + 1, stages.length);
		}
		if (!signal?.aborted) pdf.save('cldt-stages-map.pdf');
	} finally {
		map.setView(originalCenter, originalZoom);
	}
}
