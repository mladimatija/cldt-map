/**
 * PDF generator for the trip brief. Portrait A4, one page per day plus a
 * cover and a back-page emergency / generated-on stub.
 *
 * two PDFs read as the same family of a document:
 *   - 14 mm gray header band on every page (no separate blue cover banner)
 *   - Logo (icon-192.png) at top-left, linked to the project site
 *   - Bold Noto Sans title text on line 1 of the header
 *   - Colored stat segments on line 2: green gain, red loss, gray ETA
 *
 * Map snapshots reuse the strip-map exporter's capture pipeline: we pan /
 * zoom the live Leaflet map to each stage's bounds, wait for tiles to
 * settle, dump the leaflet-container DOM to a blob via `html-to-image`,
 * and crop to the page aspect ratio.
 *
 * Dependencies (`jspdf`, `html-to-image`) are lazy-imported so the main
 * bundle stays slim - the PDF path is rarely the user's entry point.
 *
 * Typography: jsPDF's built-in helvetica is WinAnsi (CP1252) only, which
 * cannot render Croatian (č ć š ž đ) or Latin Extended-A diacritics. We
 * register a subsetted Noto Sans (Regular + Bold) via `registerTripBriefFonts`
 * so all four locales render with full diacritics. There is no Italic face
 * because the italic strings in this generator are short captions whose
 * styling intent is preserved well enough with regular weight.
 */

import {
	MAP_RENDER_SETTLE_MS,
	blobToDataUrl,
	cropToAspect,
	makeCaptureFilter,
	pointsToBounds,
	type LeafletMapForExport,
} from '@/lib/export-utils';
import { findNearestPointIndex, formatEta } from '@/lib/distance-utils';
import { formatElevation } from '@/lib/utils';
import { siteMetadata } from '@/lib/metadata';
import type { TripBrief, TripBriefDay } from '@/lib/trip-brief';
import type { EnhancedTrailPoint } from '@/lib/store/types';
import {
	DAYS_HEADING,
	EMERGENCY_BODY,
	LBL,
	MORE_LABEL,
	dayHeader,
	directionDisplay,
	formatGeneratedAt,
	formatKmRound,
	todayIsoDate,
} from '@/lib/trip-brief-i18n';
import { registerTripBriefFonts } from '@/lib/trip-brief-fonts';
// Type-only import keeps jspdf out of the runtime bundle while letting the
// rest of this module type-check normally; the real jsPDF is lazy-imported
// inside `exportTripBriefPdf`.
import type { jsPDF as JsPDF } from 'jspdf';

export interface TripBriefPdfArgs {
	brief: TripBrief;
	enhancedTrailPoints: EnhancedTrailPoint[];
	map: LeafletMapForExport;
	mapEl?: HTMLElement;
	onProgress?: (current: number, total: number) => void;
	signal?: AbortSignal;
}

// A4 portrait: 210 x 297 mm. Header band: 14 mm (matches strip-map). Map
// image: 174 x 110 mm. Cap on POI rows per day so a 300-place stretch
// doesn't produce a wall of unreadable rows truncated mid-list at the
// page margin; remainder is summarised as a "+ N more" footer line.
const PAGE_W = 210;
const PAGE_H = 297;
const HEADER_H = 14;
const MAP_W = 174;
const MAP_H = 110;
const MARGIN_X = 18;
const MAX_POIS_PER_DAY = 25;

// Header / stat-segment colours - matched to the strip-map PDF
// (`export-utils.ts`) so the two documents look like the same brand.
const HEADER_BG_RGB: [number, number, number] = [240, 240, 240];
const HEADER_TEXT_RGB: [number, number, number] = [40, 40, 40];
const STAT_GAIN_RGB: [number, number, number] = [22, 163, 74]; // green-600
const STAT_LOSS_RGB: [number, number, number] = [239, 68, 68]; // red-500
const STAT_NEUTRAL_RGB: [number, number, number] = [40, 40, 40];
const SECTION_BLUE_RGB: [number, number, number] = [3, 105, 161];
const BODY_TEXT_RGB: [number, number, number] = [60, 60, 60];
const MUTED_TEXT_RGB: [number, number, number] = [110, 110, 110];
const ALERT_RGB: [number, number, number] = [192, 65, 12];
const FOOTER_RGB: [number, number, number] = [140, 140, 140];

/**
 * Generates the PDF and triggers a browser download. Resolves once the PDF
 * has been saved; rejects on aborted signal or any unrecoverable error.
 */
export async function exportTripBriefPdf(args: TripBriefPdfArgs): Promise<void> {
	const { brief, enhancedTrailPoints, map, mapEl, onProgress, signal } = args;

	const [{ jsPDF }, { toBlob }] = await Promise.all([import('jspdf'), import('html-to-image')]);
	const resolvedMapEl = mapEl ?? document.querySelector<HTMLElement>('.leaflet-container');
	if (!resolvedMapEl) throw new Error('leaflet-container not found');

	const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
	// Embed Noto Sans before any setFont call so Croatian / German diacritics
	// render as glyphs instead of placeholder boxes.
	await registerTripBriefFonts(pdf);
	const captureFilter = makeCaptureFilter(resolvedMapEl);

	// Logo fetched once and reused on every page. Best-effort - if the icon
	// asset isn't reachable (offline screenshot environment, missing build)
	// we just skip the logo without erroring out the whole PDF.
	const logoDataUrl = await fetch('/icon-192.png')
		.then((r) => r.blob())
		.then(blobToDataUrl)
		.catch(() => null);

	const originalCenter = map.getCenter();
	const originalZoom = map.getZoom();

	const totalSteps = 1 + brief.days.length + 1; // cover + days + back page
	let step = 0;
	const tick = (): void => {
		step++;
		onProgress?.(step, totalSteps);
	};

	try {
		const totalPages = brief.days.length + 2;
		// Cover page
		renderCover(pdf, brief, logoDataUrl);
		footer(pdf, 1, totalPages);
		tick();
		if (signal?.aborted) return;

		// Per-day pages
		for (let dayIdx = 0; dayIdx < brief.days.length; dayIdx++) {
			const day = brief.days[dayIdx];
			if (signal?.aborted) return;
			pdf.addPage();
			const snapshot = await captureStageMap(
				map,
				resolvedMapEl,
				enhancedTrailPoints,
				day,
				captureFilter,
				toBlob,
				signal,
			);
			renderDay(pdf, brief, day, snapshot, logoDataUrl);
			footer(pdf, dayIdx + 2, totalPages);
			tick();
		}

		// Back page
		if (signal?.aborted) return;
		pdf.addPage();
		renderBackPage(pdf, brief, logoDataUrl);
		footer(pdf, totalPages, totalPages);
		tick();

		pdf.save(`cldt-trip-brief-${todayIsoDate()}.pdf`);
	} finally {
		// Restore the live map view so the user doesn't lose their place.
		try {
			map.setView(originalCenter, originalZoom);
		} catch {
			// best-effort
		}
	}
}

// ── Header band ─────────────────────────────────────────────────────────────

/**
 * Shared header band painter. Lays down the grey background, the logo (with
 * click-through link to the site), and the two-line text block:
 *   - Line 1: bold title at the left edge (after the logo)
 *   - Line 2: coloured stat segments at the same left edge
 *
 * `statSegments` is rendered with explicit per-segment colour so the day
 * header reads "+gain (green) -loss (red) eta (gray)" exactly like the
 * strip-map header. Passing an empty array hides line 2.
 */
function paintHeaderBand(
	pdf: JsPDF,
	title: string,
	statSegments: { text: string; rgb: [number, number, number] }[],
	logoDataUrl: string | null,
): void {
	pdf.setFillColor(...HEADER_BG_RGB);
	pdf.rect(0, 0, PAGE_W, HEADER_H, 'F');

	const logoSize = 12;
	const logoX = 1;
	const logoY = 1;
	const textX = logoDataUrl ? logoX + logoSize + 3 : MARGIN_X;

	if (logoDataUrl) {
		pdf.addImage(logoDataUrl, 'PNG', logoX, logoY, logoSize, logoSize);
		pdf.link(logoX, logoY, logoSize, logoSize, { url: siteMetadata.companyUrl });
	}

	pdf.setFont('NotoSans', 'bold');
	pdf.setFontSize(10);
	pdf.setTextColor(...HEADER_TEXT_RGB);
	pdf.text(title, textX, 6);

	if (statSegments.length > 0) {
		pdf.setFont('NotoSans', 'normal');
		pdf.setFontSize(9);
		let cursor = textX;
		for (let i = 0; i < statSegments.length; i++) {
			const seg = statSegments[i];
			pdf.setTextColor(...seg.rgb);
			// Two-space separator between segments matches the strip-map
			// header rhythm so neither feels denser than the other.
			const text = i === 0 ? seg.text : `  ${seg.text}`;
			pdf.text(text, cursor, 11);
			cursor += pdf.getTextWidth(text);
		}
	}
}

// ── Section renderers ───────────────────────────────────────────────────────

function renderCover(pdf: JsPDF, brief: TripBrief, logoDataUrl: string | null): void {
	const { meta, overview } = brief;

	// Cover header: same grey band as every other page, but the title text
	// is the document title (not a per-day breadcrumb) and the second line
	// is the generated-on date.
	paintHeaderBand(
		pdf,
		meta.title,
		[{ text: formatGeneratedAt(meta.generatedAt, meta.locale), rgb: STAT_NEUTRAL_RGB }],
		logoDataUrl,
	);

	// "Overview" section heading - bold, slightly bigger, brand blue so the
	// cover reads more like a title page than a body page despite sharing
	// the grey header.
	pdf.setFont('NotoSans', 'bold');
	pdf.setFontSize(18);
	pdf.setTextColor(...SECTION_BLUE_RGB);
	pdf.text(LBL[meta.locale].overview, MARGIN_X, HEADER_H + 14);

	// Stats grid: bold key in dark text, value in body text aligned to a
	// fixed column.
	pdf.setFontSize(11);
	const grid: [string, string][] = [
		[LBL[meta.locale].totalDistance, formatKmRound(overview.totalKm, meta.units)],
		[LBL[meta.locale].dayCount, `${overview.dayCount}`],
		[LBL[meta.locale].direction, directionDisplay(meta.direction, meta.locale)],
		[LBL[meta.locale].gain, `+${formatElevation(overview.totalGainM, meta.units)}`],
		[LBL[meta.locale].loss, `-${formatElevation(overview.totalLossM, meta.units)}`],
		[LBL[meta.locale].eta, formatEta(overview.totalDurationSec)],
		[LBL[meta.locale].pace, `${meta.walkingPaceKmh.toFixed(1)} km/h`],
	];
	let y = HEADER_H + 26;
	for (const [k, v] of grid) {
		pdf.setFont('NotoSans', 'bold');
		pdf.setTextColor(...HEADER_TEXT_RGB);
		pdf.text(k, MARGIN_X, y);
		pdf.setFont('NotoSans', 'normal');
		pdf.setTextColor(...BODY_TEXT_RGB);
		pdf.text(v, MARGIN_X + 60, y);
		y += 8;
	}

	// Narrative paragraph below the grid. Italic + muted so it reads as
	// caption text rather than primary content.
	y += 6;
	pdf.setFont('NotoSans', 'normal');
	pdf.setTextColor(...MUTED_TEXT_RGB);
	pdf.setFontSize(10);
	const wrapped = pdf.splitTextToSize(overview.narrative, PAGE_W - MARGIN_X * 2) as string[];
	pdf.text(wrapped, MARGIN_X, y);
	y += wrapped.length * 5 + 10;

	// Per-day at-a-glance table on the cover. Lets the reader see the
	// whole trip arc on page 1 without flipping. Three columns: day label,
	// distance, ETA. Capped to whatever fits in the remaining vertical
	// space so the cover never overflows.
	pdf.setFont('NotoSans', 'bold');
	pdf.setTextColor(...SECTION_BLUE_RGB);
	pdf.setFontSize(12);
	pdf.text(DAYS_HEADING[meta.locale], MARGIN_X, y);
	y += 6;

	pdf.setFontSize(9);
	pdf.setFont('NotoSans', 'normal');
	for (const day of brief.days) {
		if (y > PAGE_H - 30) break;
		const distKm = day.endKm - day.startKm;
		const distStr = formatKmRound(distKm, meta.units);
		const eta = formatEta(day.etaSec);
		const headerStr = dayHeader(day, meta.locale, meta.units);
		pdf.setFont('NotoSans', 'bold');
		pdf.setTextColor(...HEADER_TEXT_RGB);
		pdf.text(headerStr, MARGIN_X, y);
		pdf.setFont('NotoSans', 'normal');
		pdf.setTextColor(...BODY_TEXT_RGB);
		pdf.text(distStr, MARGIN_X + 100, y);
		pdf.text(eta, MARGIN_X + 140, y);
		y += 5;
	}
}

function renderDay(
	pdf: JsPDF,
	brief: TripBrief,
	day: TripBriefDay,
	snapshot: string | null,
	logoDataUrl: string | null,
): void {
	const { meta } = brief;

	// Header: line 1 "Day N / total | km X-Y | dist", line 2 coloured
	// stat segments (green gain, red loss, gray ETA). Same shape as the
	// strip-map per-stage header.
	const distKm = day.endKm - day.startKm;
	const headerTitle = `${dayHeader(day, meta.locale, meta.units)}  |  ${formatKmRound(distKm, meta.units)}`;
	const gainStr = formatElevation(day.gainM, meta.units);
	const lossStr = formatElevation(day.lossM, meta.units);
	const etaStr = formatEta(day.etaSec);
	paintHeaderBand(
		pdf,
		headerTitle,
		[
			{ text: `+${gainStr}`, rgb: STAT_GAIN_RGB },
			{ text: `-${lossStr}`, rgb: STAT_LOSS_RGB },
			{ text: etaStr, rgb: STAT_NEUTRAL_RGB },
		],
		logoDataUrl,
	);

	// Map snapshot
	let yCursor = HEADER_H + 4;
	if (snapshot) {
		pdf.addImage(snapshot, 'PNG', MARGIN_X, yCursor, MAP_W, MAP_H);
		yCursor += MAP_H + 6;
	}

	// Day narrative
	pdf.setFont('NotoSans', 'normal');
	pdf.setTextColor(...MUTED_TEXT_RGB);
	pdf.setFontSize(10);
	const wrapped = pdf.splitTextToSize(day.narrative, PAGE_W - MARGIN_X * 2) as string[];
	pdf.text(wrapped, MARGIN_X, yCursor);
	yCursor += wrapped.length * 4 + 4;

	// Seasonal alerts (if any)
	if (day.seasonalAlerts.length > 0) {
		pdf.setFont('NotoSans', 'bold');
		pdf.setTextColor(...ALERT_RGB);
		pdf.setFontSize(10);
		pdf.text(LBL[meta.locale].alerts, MARGIN_X, yCursor);
		yCursor += 5;
		pdf.setFont('NotoSans', 'normal');
		pdf.setTextColor(...MUTED_TEXT_RGB);
		pdf.setFontSize(9);
		for (const a of day.seasonalAlerts) {
			const line = pdf.splitTextToSize(`- [${a.severity}] ${a.title}`, PAGE_W - MARGIN_X * 2) as string[];
			pdf.text(line, MARGIN_X, yCursor);
			yCursor += line.length * 4 + 1;
			if (yCursor > PAGE_H - 20) break; // don't overflow
		}
		yCursor += 4;
	}

	// POIs along the way - capped so the column doesn't run off the page.
	// Sorting + selection lives in the trip-brief assembler; here we just
	// take the first N and tack on a "+ remaining" line.
	if (day.pois.length > 0) {
		pdf.setFont('NotoSans', 'bold');
		pdf.setTextColor(...SECTION_BLUE_RGB);
		pdf.setFontSize(11);
		pdf.text(`${LBL[meta.locale].pois} (${day.pois.length})`, MARGIN_X, yCursor);
		yCursor += 5;
		pdf.setTextColor(...BODY_TEXT_RGB);
		pdf.setFontSize(9);

		const pageBudget = PAGE_H - 22;
		const visiblePois = day.pois.slice(0, MAX_POIS_PER_DAY);
		const remainder = day.pois.length - visiblePois.length;

		for (const poi of visiblePois) {
			if (yCursor > pageBudget) break;
			// Bold name, then a single literal " - " separator, then the
			// non-bold meta string. Earlier version emitted "  meta..."
			// with leading spaces, but PDF rendering collapses spaces at
			// the start of a text run so the name and meta ran together.
			pdf.setFont('NotoSans', 'bold');
			pdf.text(poi.name, MARGIN_X, yCursor);
			const nameWidth = pdf.getTextWidth(poi.name);
			pdf.setFont('NotoSans', 'normal');
			const offTrailFrag =
				poi.distanceFromTrailKm >= 0.5 ? ` - ${formatKmRound(poi.distanceFromTrailKm, meta.units)} off-trail` : '';
			const metaLine = ` - ${poi.typeLabel} - km ${poi.trailKm.toFixed(0)}${offTrailFrag}`;
			pdf.text(metaLine, MARGIN_X + nameWidth, yCursor);
			yCursor += 4;
			if (poi.summary) {
				pdf.setTextColor(...MUTED_TEXT_RGB);
				const sLines = pdf.splitTextToSize(poi.summary, PAGE_W - MARGIN_X * 2 - 4) as string[];
				const truncated = sLines.slice(0, 2);
				pdf.text(truncated, MARGIN_X + 4, yCursor);
				yCursor += truncated.length * 3.5;
				pdf.setTextColor(...BODY_TEXT_RGB);
			}
			yCursor += 2;
		}

		if (remainder > 0 && yCursor <= pageBudget) {
			pdf.setFont('NotoSans', 'normal');
			pdf.setTextColor(...MUTED_TEXT_RGB);
			pdf.text(`+ ${remainder} ${MORE_LABEL[meta.locale]}`, MARGIN_X, yCursor);
		}
	}
}

function renderBackPage(pdf: JsPDF, brief: TripBrief, logoDataUrl: string | null): void {
	const { meta } = brief;

	paintHeaderBand(pdf, LBL[meta.locale].emergency, [], logoDataUrl);

	let y = HEADER_H + 14;
	pdf.setFontSize(11);
	pdf.setFont('NotoSans', 'normal');
	pdf.setTextColor(...BODY_TEXT_RGB);
	const lines = EMERGENCY_BODY[meta.locale];
	for (const line of lines) {
		const wrapped = pdf.splitTextToSize(line, PAGE_W - MARGIN_X * 2) as string[];
		pdf.text(wrapped, MARGIN_X, y);
		y += wrapped.length * 6 + 3;
	}

	pdf.setFontSize(9);
	pdf.setTextColor(...FOOTER_RGB);
	pdf.text(`${LBL[meta.locale].generated} ${formatGeneratedAt(meta.generatedAt, meta.locale)}`, MARGIN_X, PAGE_H - 12);
}

function footer(pdf: JsPDF, page: number, totalPages: number): void {
	pdf.setFontSize(8);
	pdf.setTextColor(...FOOTER_RGB);
	pdf.setFont('NotoSans', 'normal');
	pdf.text(`${page} / ${totalPages}`, PAGE_W - MARGIN_X, PAGE_H - 6, { align: 'right' });
	pdf.text('map.cldt.hr', MARGIN_X, PAGE_H - 6);
}

// ── Map snapshot helper ─────────────────────────────────────────────────────

async function captureStageMap(
	map: LeafletMapForExport,
	mapEl: HTMLElement,
	enhancedTrailPoints: EnhancedTrailPoint[],
	day: TripBriefDay,
	captureFilter: (node: Element) => boolean,
	toBlob: typeof import('html-to-image').toBlob,
	signal?: AbortSignal,
): Promise<string | null> {
	if (signal?.aborted) return null;
	const startIdx = findNearestPointIndex(enhancedTrailPoints, day.startKm * 1000);
	const endIdx = findNearestPointIndex(enhancedTrailPoints, day.endKm * 1000);
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
	await new Promise<void>((resolve) => setTimeout(resolve, MAP_RENDER_SETTLE_MS));
	if (signal?.aborted) return null;
	const blob = await toBlob(mapEl, { cacheBust: true, filter: captureFilter });
	if (!blob) return null;
	const dataUrl = await blobToDataUrl(blob);
	return cropToAspect(dataUrl, MAP_W, MAP_H);
}

// ── Localisation helpers ────────────────────────────────────────────────────
// All shared labels (LBL, DAYS_HEADING, MORE_LABEL, dayHeader, directionDisplay,
// formatKmRound, todayIsoDate, EMERGENCY_BODY) are imported from trip-brief-i18n.
