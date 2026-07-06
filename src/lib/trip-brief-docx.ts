/**
 * DOCX generator for the trip brief. Same content as the PDF generator, but
 * editable: hikers who want to add personal notes (emergency contacts,
 * dietary restrictions, kit checklist) can drop the file into Word /
 * LibreOffice / Pages and finish it by hand.
 *
 * The `docx` dependency is lazy-imported so the main bundle stays slim.
 * Per-day map snapshots reuse the same Leaflet capture pipeline as the PDF
 * exporter (`captureStageMapSnapshot` in export-utils).
 */

import { formatEta } from '@/lib/distance-utils';
import { captureStageMapSnapshot, makeCaptureFilter, type LeafletMapForExport } from '@/lib/export-utils';
import { formatElevation } from '@/lib/utils';
import type { TripBrief } from '@/lib/trip-brief';
import type { EnhancedTrailPoint } from '@/lib/store/types';
import { dataUrlToBytes } from './elevation-thumbnail';
import { downloadBlob } from './gpx-export';
import {
	dayDateLabel,
	emergencyLines,
	dayHeader,
	directionDisplay,
	formatGeneratedAt,
	formatKmRound,
	todayIsoDate,
} from '@/lib/trip-brief-i18n';

/** Display width matches the elevation thumbnail; height keeps PDF map aspect. */
const MAP_IMG_W = 522;
const MAP_IMG_H = 330;

export interface TripBriefDocxArgs {
	brief: TripBrief;
	enhancedTrailPoints: EnhancedTrailPoint[];
	map: LeafletMapForExport;
	mapEl?: HTMLElement;
	onProgress?: (current: number, total: number) => void;
	signal?: AbortSignal;
}

/**
 * Renders the brief to a DOCX blob and triggers a browser download.
 * Resolves once the file has been saved. Aborts are honoured at section
 * boundaries.
 */
export async function exportTripBriefDocx(args: TripBriefDocxArgs): Promise<void> {
	const { brief, enhancedTrailPoints, map, mapEl, onProgress, signal } = args;
	const totalSteps = 1 + brief.days.length + 1;
	let step = 0;
	const tick = (): void => {
		step++;
		onProgress?.(step, totalSteps);
	};

	const resolvedMapEl = mapEl ?? document.querySelector<HTMLElement>('.leaflet-container');
	if (!resolvedMapEl) throw new Error('leaflet-container not found');

	const [{ Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType, LevelFormat, ImageRun }, { toBlob }] =
		await Promise.all([import('docx'), import('html-to-image')]);
	type DocxParagraph = InstanceType<typeof Paragraph>;

	const captureFilter = makeCaptureFilter(resolvedMapEl);
	const originalCenter = map.getCenter();
	const originalZoom = map.getZoom();

	// ── Section builders (closures over imported docx classes) ────────────────

	function buildCover(): DocxParagraph[] {
		const { meta, overview } = brief;
		const out: DocxParagraph[] = [];

		out.push(
			new Paragraph({
				text: meta.title,
				heading: HeadingLevel.TITLE,
				alignment: AlignmentType.CENTER,
			}),
		);
		out.push(
			new Paragraph({
				children: [
					new TextRun({ text: formatGeneratedAt(meta.generatedAt, meta.locale), italics: true, color: '808080' }),
				],
				alignment: AlignmentType.CENTER,
				spacing: { after: 400 },
			}),
		);

		out.push(new Paragraph({ text: meta.strings.labels.overview, heading: HeadingLevel.HEADING_1 }));

		const grid: [string, string][] = [
			[meta.strings.labels.totalDistance, formatKmRound(overview.totalKm, meta.units)],
			[meta.strings.labels.dayCount, `${overview.dayCount}`],
			[meta.strings.labels.direction, directionDisplay(meta.direction, meta.strings)],
			[meta.strings.labels.gain, `+${formatElevation(overview.totalGainM, meta.units)}`],
			[meta.strings.labels.loss, `-${formatElevation(overview.totalLossM, meta.units)}`],
			[meta.strings.labels.eta, formatEta(overview.totalDurationSec)],
			[meta.strings.labels.pace, `${meta.walkingPaceKmh.toFixed(1)} km/h`],
			...(meta.packSummary ? [[meta.strings.labels.pack, meta.packSummary] as [string, string]] : []),
			...(meta.resupplySummary
				? [[meta.strings.labels.resupplyCadence, meta.resupplySummary] as [string, string]]
				: []),
		];
		for (const [k, v] of grid) {
			out.push(
				new Paragraph({
					children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun({ text: v })],
				}),
			);
		}

		out.push(
			new Paragraph({
				children: [new TextRun({ text: overview.narrative, italics: true })],
				spacing: { before: 240, after: 240 },
			}),
		);

		// AI accuracy disclaimer: shown to every reader of the document when
		// the narratives were AI-generated, not only the person who toggled it.
		if (meta.aiDisclaimer) {
			out.push(
				new Paragraph({
					children: [new TextRun({ text: meta.aiDisclaimer, italics: true, size: 16, color: '888888' })],
					spacing: { after: 240 },
				}),
			);
		}

		return out;
	}

	function buildDay(dayIndex: number, mapSnapshot: string | null): DocxParagraph[] {
		const day = brief.days[dayIndex];
		const { meta } = brief;
		const out: DocxParagraph[] = [];
		const dateLabel = dayDateLabel(day, meta.locale);

		// Rest days: heading + optional date + body paragraph only. No map,
		// elevation, stats, alerts, or POIs - a rest day has no km bounds.
		if (day.kind === 'rest') {
			out.push(
				new Paragraph({
					text: meta.strings.restDay.heading,
					heading: HeadingLevel.HEADING_1,
					pageBreakBefore: true,
				}),
			);
			if (dateLabel) {
				out.push(new Paragraph({ children: [new TextRun({ text: dateLabel, color: '707070' })] }));
			}
			out.push(
				new Paragraph({
					children: [new TextRun({ text: day.narrative, italics: true })],
					spacing: { before: 200, after: 200 },
				}),
			);
			return out;
		}

		out.push(
			new Paragraph({
				text: dayHeader(day, meta.strings, meta.units),
				heading: HeadingLevel.HEADING_1,
				pageBreakBefore: true,
			}),
		);
		if (dateLabel) {
			out.push(new Paragraph({ children: [new TextRun({ text: dateLabel, color: '707070' })] }));
		}
		out.push(
			new Paragraph({
				children: [
					new TextRun({ text: `+${formatElevation(day.gainM, meta.units)}  `, color: '16a34a', bold: true }),
					new TextRun({ text: `-${formatElevation(day.lossM, meta.units)}  `, color: 'ef4444', bold: true }),
					new TextRun({ text: formatEta(day.etaSec), color: '404040' }),
				],
			}),
		);
		if (mapSnapshot) {
			out.push(
				new Paragraph({
					children: [
						new ImageRun({
							data: dataUrlToBytes(mapSnapshot),
							transformation: { width: MAP_IMG_W, height: MAP_IMG_H },
							type: 'png',
						}),
					],
					spacing: { after: 120 },
				}),
			);
		}
		if (day.elevationThumb) {
			out.push(
				new Paragraph({
					children: [
						new ImageRun({
							data: dataUrlToBytes(day.elevationThumb),
							transformation: { width: 522, height: 90 },
							type: 'png',
						}),
					],
				}),
			);
		}
		if (day.packBaseLabel) {
			out.push(new Paragraph({ children: [new TextRun({ text: day.packBaseLabel, color: '0e7490' })] }));
		}
		if (day.packLoadedLabel) {
			out.push(new Paragraph({ children: [new TextRun({ text: day.packLoadedLabel, color: '0e7490' })] }));
		}
		for (const label of [day.resupplyEnteringLabel, day.resupplyCarryLabel, day.foodPackLabel].filter(
			(line): line is string => !!line,
		)) {
			out.push(new Paragraph({ children: [new TextRun({ text: label, color: 'b45309' })] }));
		}
		out.push(
			new Paragraph({
				children: [new TextRun({ text: day.narrative, italics: true })],
				spacing: { before: 200, after: 200 },
			}),
		);

		if (day.seasonalAlerts.length > 0) {
			out.push(new Paragraph({ text: meta.strings.labels.alerts, heading: HeadingLevel.HEADING_2 }));
			for (const alert of day.seasonalAlerts) {
				out.push(
					new Paragraph({
						numbering: { reference: 'bullet', level: 0 },
						children: [
							new TextRun({ text: `[${alert.severity}] `, bold: true, color: 'c2410c' }),
							new TextRun({ text: alert.title }),
						],
					}),
				);
			}
		}

		if (day.pois.length > 0) {
			out.push(
				new Paragraph({
					text: `${meta.strings.labels.pois} (${day.pois.length})`,
					heading: HeadingLevel.HEADING_2,
				}),
			);
			for (const poi of day.pois) {
				const off =
					poi.distanceFromTrailKm >= 0.5 ? ` · ${formatKmRound(poi.distanceFromTrailKm, meta.units)} off-trail` : '';
				out.push(
					new Paragraph({
						numbering: { reference: 'bullet', level: 0 },
						children: [
							new TextRun({ text: poi.name, bold: true }),
							new TextRun({
								text: `  ${poi.typeLabel} · km ${poi.trailKm.toFixed(0)}${off}${poi.resupply ? ` · ${meta.strings.labels.resupply}` : ''}`,
								color: '707070',
							}),
						],
					}),
				);
				if (poi.summary) {
					out.push(
						new Paragraph({
							indent: { left: 720 },
							children: [new TextRun({ text: poi.summary, color: '707070', size: 18 })],
						}),
					);
				}
			}
		}

		return out;
	}

	function buildBackPage(): DocxParagraph[] {
		const { meta } = brief;
		const out: DocxParagraph[] = [];

		if (meta.gearChecklist) {
			out.push(
				new Paragraph({ text: meta.gearChecklist.heading, heading: HeadingLevel.HEADING_1, pageBreakBefore: true }),
			);
			if (meta.gearChecklist.missingLine) {
				out.push(
					new Paragraph({
						children: [new TextRun({ text: meta.gearChecklist.missingLine, color: 'b45309', bold: true })],
					}),
				);
			}
			for (const cat of meta.gearChecklist.categories) {
				out.push(new Paragraph({ text: cat.name, heading: HeadingLevel.HEADING_2 }));
				for (const line of cat.lines) {
					out.push(new Paragraph({ children: [new TextRun({ text: `[ ] ${line}` })] }));
				}
			}
		}

		out.push(
			new Paragraph({
				text: meta.strings.labels.emergency,
				heading: HeadingLevel.HEADING_1,
				pageBreakBefore: true,
			}),
		);
		for (const line of emergencyLines(meta.strings)) {
			out.push(new Paragraph({ children: [new TextRun({ text: line })], spacing: { after: 100 } }));
		}

		// "For your safety contact" handoff sub-block (intro, per-day, call-112
		// closing), so the editable document carries the same overdue-hiker plan.
		if (meta.safetyContactLines?.length) {
			out.push(
				new Paragraph({
					text: meta.safetyContactHeading ?? meta.strings.labels.safetyContact,
					heading: HeadingLevel.HEADING_2,
					spacing: { before: 240 },
				}),
			);
			for (const line of meta.safetyContactLines) {
				out.push(new Paragraph({ children: [new TextRun({ text: line })], spacing: { after: 100 } }));
			}
		}

		out.push(
			new Paragraph({
				children: [
					new TextRun({
						text: `${meta.strings.labels.generated} ${formatGeneratedAt(meta.generatedAt, meta.locale)} | map.cldt.hr`,
						italics: true,
						color: '8c8c8c',
						size: 18,
					}),
				],
				spacing: { before: 600 },
			}),
		);

		return out;
	}

	// ── Build and export ──────────────────────────────────────────────────────

	const cover = buildCover();
	tick();
	if (signal?.aborted) return;

	const dayBlocks: DocxParagraph[] = [];
	try {
		for (let i = 0; i < brief.days.length; i++) {
			if (signal?.aborted) return;
			const day = brief.days[i];
			// Rest days carry no km bounds to capture a map for.
			const mapSnapshot =
				day.kind === 'rest'
					? null
					: await captureStageMapSnapshot(
							map,
							resolvedMapEl,
							enhancedTrailPoints,
							day.startKm,
							day.endKm,
							captureFilter,
							toBlob,
							MAP_IMG_W,
							MAP_IMG_H,
							signal,
						);
			dayBlocks.push(...buildDay(i, mapSnapshot));
			tick();
		}
	} finally {
		try {
			map.setView(originalCenter, originalZoom);
		} catch {
			// best-effort
		}
	}

	if (signal?.aborted) return;
	const backPage = buildBackPage();
	tick();

	const doc = new Document({
		creator: 'CLDT Map',
		title: brief.meta.title,
		description: 'Trip brief generated by map.cldt.hr',
		numbering: {
			config: [
				{
					reference: 'bullet',
					levels: [
						{
							level: 0,
							format: LevelFormat.BULLET,
							text: '•',
							alignment: AlignmentType.LEFT,
						},
					],
				},
			],
		},
		sections: [
			{
				properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
				children: [...cover, ...dayBlocks, ...backPage],
			},
		],
	});

	const blob = await Packer.toBlob(doc);
	downloadBlob(blob, `cldt-trip-brief-${todayIsoDate()}.docx`, blob.type);
}

// ── Localisation ────────────────────────────────────────────────────────────
// Shared labels (LBL), EMERGENCY_BODY, dayHeader, directionDisplay,
// formatKmRound, todayIsoDate are imported from trip-brief-i18n.
