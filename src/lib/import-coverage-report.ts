/**
 * CSV / PDF export for imported GPX track deviation and coverage reports.
 * Stats come from `computeTrackStats`; POI proximity from `findPoisNearTrack`.
 */
import type { ImportedTrack } from '@/lib/store/types';
import { downloadTextFile } from '@/lib/user-waypoints';
import { registerTripBriefFonts, TRIP_BRIEF_FONT_FAMILY } from '@/lib/trip-brief-fonts';
import type { jsPDF as JsPDF } from 'jspdf';

export interface CoverageReportPoiRow {
	name: string;
	type: string;
	closestDistance: string;
	atTrackKm: string;
	/** Pre-formatted proximity line for PDF (e.g. "0.16 km off track · at 20.0 km along recording"). */
	summaryLine: string;
}

/** Pre-formatted display strings and section headings (from i18n). */
export interface CoverageReportContent {
	title: string;
	trackLabel: string;
	trackName: string;
	importedLabel: string;
	importedAt: string;
	generatedLabel: string;
	generatedAt: string;
	summaryHeading: string;
	distanceLabel: string;
	distanceValue: string;
	elapsedLabel: string;
	elapsedValue: string;
	movingLabel: string;
	movingValue: string | null;
	avgPaceLabel: string;
	avgPaceValue: string;
	maxDeviationLabel: string;
	maxDeviationValue: string;
	coverageLabel: string;
	coverageValue: string;
	coverageNote: string;
	poisHeading: string;
	poisLegend: string;
	poisNone: string;
	poiColName: string;
	poiColType: string;
	poiColClosest: string;
	poiColAtKm: string;
	poiRows: CoverageReportPoiRow[];
}

function safeFilenameBase(name: string): string {
	const slug = name
		.trim()
		.replace(/[^\p{L}\p{N}-]+/gu, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 48);
	return slug || 'track';
}

function csvEscape(value: string): string {
	// Neutralize CSV/formula injection (CWE-1236): a cell beginning with one of
	// = + - @ tab/CR is treated as a formula by Excel/LibreOffice/Sheets. The
	// track and POI name columns derive from attacker-controlled GPX <name>
	// elements, so prefix any such value with a single quote before quoting.
	const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
	return guarded;
}

function csvRow(cells: string[]): string {
	return cells.map(csvEscape).join(',');
}

export function buildCoverageReportCsv(content: CoverageReportContent): string {
	const lines: string[] = [];
	lines.push(csvRow([content.title]));
	lines.push(csvRow([content.trackLabel, content.trackName]));
	lines.push(csvRow([content.importedLabel, content.importedAt]));
	lines.push(csvRow([content.generatedLabel, content.generatedAt]));
	lines.push('');
	lines.push(csvRow([content.summaryHeading]));
	lines.push(csvRow([content.distanceLabel, content.distanceValue]));
	lines.push(csvRow([content.elapsedLabel, content.elapsedValue]));
	if (content.movingValue) {
		lines.push(csvRow([content.movingLabel, content.movingValue]));
	}
	lines.push(csvRow([content.avgPaceLabel, content.avgPaceValue]));
	lines.push(csvRow([content.maxDeviationLabel, content.maxDeviationValue]));
	lines.push(csvRow([content.coverageLabel, content.coverageValue]));
	lines.push(csvRow([content.coverageNote]));
	lines.push('');
	lines.push(csvRow([content.poisHeading]));
	lines.push(csvRow([content.poisLegend]));
	if (content.poiRows.length === 0) {
		lines.push(csvRow([content.poisNone]));
	} else {
		lines.push(csvRow([content.poiColName, content.poiColType, content.poiColClosest, content.poiColAtKm]));
		for (const row of content.poiRows) {
			lines.push(csvRow([row.name, row.type, row.closestDistance, row.atTrackKm]));
		}
	}
	return `\uFEFF${lines.join('\n')}\n`;
}

export function downloadCoverageReportCsv(content: CoverageReportContent, track: ImportedTrack): void {
	const csv = buildCoverageReportCsv(content);
	downloadTextFile(csv, `cldt-coverage-${safeFilenameBase(track.name)}.csv`, 'text/csv');
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const LINE_H = 5.5;

function ensureSpace(pdf: JsPDF, y: number, need: number): number {
	if (y + need <= PAGE_H - MARGIN) return y;
	pdf.addPage();
	return MARGIN;
}

function writeLines(pdf: JsPDF, lines: string[], x: number, y: number, maxW: number, lineHeight = LINE_H): number {
	for (const line of lines) {
		const parts = pdf.splitTextToSize(line, maxW) as string[];
		for (const part of parts) {
			y = ensureSpace(pdf, y, lineHeight);
			pdf.text(part, x, y);
			y += lineHeight;
		}
	}
	return y;
}

export async function exportCoverageReportPdf(content: CoverageReportContent, track: ImportedTrack): Promise<void> {
	const { jsPDF } = await import('jspdf');
	const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
	await registerTripBriefFonts(pdf);
	pdf.setFont(TRIP_BRIEF_FONT_FAMILY, 'bold');
	pdf.setFontSize(14);
	const maxW = PAGE_W - MARGIN * 2;
	let y = MARGIN;
	y = writeLines(pdf, [content.title], MARGIN, y, maxW, 7);
	y += 2;
	pdf.setFont(TRIP_BRIEF_FONT_FAMILY, 'normal');
	pdf.setFontSize(10);
	const summaryLines = [
		`${content.trackLabel}: ${content.trackName}`,
		`${content.importedLabel}: ${content.importedAt}`,
		`${content.generatedLabel}: ${content.generatedAt}`,
		'',
		content.summaryHeading,
		`${content.distanceLabel}: ${content.distanceValue}`,
		`${content.elapsedLabel}: ${content.elapsedValue}`,
	];
	if (content.movingValue) summaryLines.push(`${content.movingLabel}: ${content.movingValue}`);
	summaryLines.push(
		`${content.avgPaceLabel}: ${content.avgPaceValue}`,
		`${content.maxDeviationLabel}: ${content.maxDeviationValue}`,
		`${content.coverageLabel}: ${content.coverageValue}`,
		content.coverageNote,
		'',
		content.poisHeading,
	);
	y = writeLines(pdf, summaryLines, MARGIN, y, maxW);
	y = writeLines(pdf, [content.poisLegend], MARGIN, y, maxW);
	if (content.poiRows.length === 0) {
		y = writeLines(pdf, [content.poisNone], MARGIN, y, maxW);
	} else {
		for (const row of content.poiRows) {
			const line = `${row.name} (${row.type}) · ${row.summaryLine}`;
			y = writeLines(pdf, [line], MARGIN, y, maxW);
		}
	}
	pdf.save(`cldt-coverage-${safeFilenameBase(track.name)}.pdf`);
}
