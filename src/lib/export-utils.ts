import { BaseMapProvider } from '@/lib/services/base-map-provider';
import type { EnhancedTrailPoint, StagePlan } from '@/lib/store/types';
import { computeStageStats } from '@/lib/stage-planner';
import { findNearestPointIndex, formatEta } from '@/lib/distance-utils';
import { formatElevation, kmToMiles } from '@/lib/utils';

/** Providers whose tile servers don't send Access-Control-Allow-Origin; PNG canvas export will taint. */
const CORS_BLOCKED_PROVIDERS: string[] = [BaseMapProvider.SATELLITE, BaseMapProvider.CROATIA_TOPO];

const MAP_RENDER_SETTLE_MS = 600;

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

async function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
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

export async function exportStripMapPdf(
	stagePlan: StagePlan,
	enhancedPoints: EnhancedTrailPoint[],
	elevationPoints: { elevation: number; distanceFromStart: number }[],
	paceKmh: number,
	gradeAdjusted: boolean,
	units: 'metric' | 'imperial',
	map: LeafletMapForExport,
	onProgress?: (current: number, total: number) => void,
	stageLabel?: string,
	mapEl?: HTMLElement,
): Promise<void> {
	const { stages } = stagePlan;
	if (!stages.length || !enhancedPoints.length) return;

	const originalCenter = map.getCenter();
	const originalZoom = map.getZoom();

	const [{ jsPDF }, { toBlob }] = await Promise.all([import('jspdf'), import('html-to-image')]);

	const resolvedMapEl = mapEl ?? document.querySelector<HTMLElement>('.leaflet-container');
	if (!resolvedMapEl) throw new Error('leaflet-container not found');

	const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
	// A4 landscape: 297 × 210 mm; 14 mm header band; image fills remaining 196 mm

	const isImperial = units === 'imperial';
	const allStats = stages.map((stage) =>
		computeStageStats(stage, enhancedPoints, elevationPoints, paceKmh, gradeAdjusted),
	);

	try {
		for (let i = 0; i < stages.length; i++) {
			const stage = stages[i];
			const startIdx = findNearestPointIndex(enhancedPoints, stage.startKm * 1000);
			const endIdx = findNearestPointIndex(enhancedPoints, stage.endKm * 1000);
			const lo = Math.min(startIdx, endIdx);
			const hi = Math.max(startIdx, endIdx);

			if (hi - lo >= 1) {
				const pts = enhancedPoints.slice(lo, hi + 1);
				map.fitBounds(pointsToBounds(pts), { padding: [40, 40], animate: false });
				map.invalidateSize({ animate: false });
			}

			// Wait for tiles to re-render after map reposition
			await new Promise<void>((resolve) => setTimeout(resolve, MAP_RENDER_SETTLE_MS));

			const blob = await toBlob(resolvedMapEl, { cacheBust: true });
			const dataUrl = blob ? await blobToDataUrl(blob) : null;

			if (i > 0) pdf.addPage();

			const stats = allStats[i];
			const distKm = stage.endKm - stage.startKm;
			const distDisplay = isImperial ? kmToMiles(distKm).toFixed(1) + ' mi' : distKm.toFixed(1) + ' km';
			const gainStr = formatElevation(stats.gainM, units);
			const lossStr = formatElevation(stats.lossM, units);
			const etaStr = formatEta(stats.etaSec);

			// Header band
			pdf.setFillColor(240, 240, 240);
			pdf.rect(0, 0, 297, 14, 'F');
			pdf.setFont('helvetica', 'bold');
			pdf.setFontSize(9);
			pdf.setTextColor(40, 40, 40);
			pdf.text(`${stageLabel ?? 'Stage'} ${i + 1} / ${stages.length}  •  ${distDisplay}`, 6, 6);
			pdf.setFont('helvetica', 'normal');
			pdf.text(`↑ ${gainStr}   ↓ ${lossStr}   ${etaStr}`, 6, 11);

			if (dataUrl) {
				pdf.addImage(dataUrl, 'PNG', 0, 14, 297, 196);
			}

			onProgress?.(i + 1, stages.length);
		}
		pdf.save('cldt-strip-map.pdf');
	} finally {
		map.setView(originalCenter, originalZoom);
	}
}
