/**
 * DOCX generator for the trip brief. Same content as the PDF generator, but
 * editable: hikers who want to add personal notes (emergency contacts,
 * dietary restrictions, kit checklist) can drop the file into Word /
 * LibreOffice / Pages and finish it by hand.
 *
 * The `docx` dependency is lazy-imported so the main bundle stays slim. No
 * map snapshots in v1 (Word's image-embedding story is fiddlier than
 * jsPDF's; we leave room for a follow-up to take the same Leaflet
 * snapshots and embed them via `ImageRun`).
 */

import { formatEta } from '@/lib/distance-utils';
import { formatElevation } from '@/lib/utils';
import type { TripBrief } from '@/lib/trip-brief';
import {
	EMERGENCY_BODY,
	LBL,
	dayHeader,
	directionDisplay,
	formatGeneratedAt,
	formatKmRound,
	todayIsoDate,
} from '@/lib/trip-brief-i18n';

export interface TripBriefDocxArgs {
	brief: TripBrief;
	onProgress?: (current: number, total: number) => void;
	signal?: AbortSignal;
}

/**
 * Renders the brief to a DOCX blob and triggers a browser download.
 * Resolves once the file has been saved. Aborts are honoured at section
 * boundaries.
 */
export async function exportTripBriefDocx(args: TripBriefDocxArgs): Promise<void> {
	const { brief, onProgress, signal } = args;
	const totalSteps = 1 + brief.days.length + 1;
	let step = 0;
	const tick = (): void => {
		step++;
		onProgress?.(step, totalSteps);
	};

	const { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType, LevelFormat } = await import('docx');
	type DocxParagraph = InstanceType<typeof Paragraph>;

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

		out.push(new Paragraph({ text: LBL[meta.locale].overview, heading: HeadingLevel.HEADING_1 }));

		const grid: [string, string][] = [
			[LBL[meta.locale].totalDistance, formatKmRound(overview.totalKm, meta.units)],
			[LBL[meta.locale].dayCount, `${overview.dayCount}`],
			[LBL[meta.locale].direction, directionDisplay(meta.direction, meta.locale)],
			[LBL[meta.locale].gain, `+${formatElevation(overview.totalGainM, meta.units)}`],
			[LBL[meta.locale].loss, `-${formatElevation(overview.totalLossM, meta.units)}`],
			[LBL[meta.locale].eta, formatEta(overview.totalDurationSec)],
			[LBL[meta.locale].pace, `${meta.walkingPaceKmh.toFixed(1)} km/h`],
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

	function buildDay(dayIndex: number): DocxParagraph[] {
		const day = brief.days[dayIndex];
		const { meta } = brief;
		const out: DocxParagraph[] = [];

		out.push(
			new Paragraph({
				text: dayHeader(day, meta.locale, meta.units),
				heading: HeadingLevel.HEADING_1,
				pageBreakBefore: true,
			}),
		);
		out.push(
			new Paragraph({
				children: [
					new TextRun({ text: `+${formatElevation(day.gainM, meta.units)}  `, color: '16a34a', bold: true }),
					new TextRun({ text: `-${formatElevation(day.lossM, meta.units)}  `, color: 'ef4444', bold: true }),
					new TextRun({ text: formatEta(day.etaSec), color: '404040' }),
				],
			}),
		);
		out.push(
			new Paragraph({
				children: [new TextRun({ text: day.narrative, italics: true })],
				spacing: { before: 200, after: 200 },
			}),
		);

		if (day.seasonalAlerts.length > 0) {
			out.push(new Paragraph({ text: LBL[meta.locale].alerts, heading: HeadingLevel.HEADING_2 }));
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
					text: `${LBL[meta.locale].pois} (${day.pois.length})`,
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
							new TextRun({ text: `  ${poi.typeLabel} · km ${poi.trailKm.toFixed(0)}${off}`, color: '707070' }),
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

		out.push(
			new Paragraph({
				text: LBL[meta.locale].emergency,
				heading: HeadingLevel.HEADING_1,
				pageBreakBefore: true,
			}),
		);
		for (const line of EMERGENCY_BODY[meta.locale]) {
			out.push(new Paragraph({ children: [new TextRun({ text: line })], spacing: { after: 100 } }));
		}

		out.push(
			new Paragraph({
				children: [
					new TextRun({
						text: `${LBL[meta.locale].generated} ${formatGeneratedAt(meta.generatedAt, meta.locale)} | map.cldt.hr`,
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
	for (let i = 0; i < brief.days.length; i++) {
		if (signal?.aborted) return;
		dayBlocks.push(...buildDay(i));
		tick();
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
	downloadBlob(blob, `cldt-trip-brief-${todayIsoDate()}.docx`);
}

// ── Localisation ────────────────────────────────────────────────────────────
// Shared labels (LBL), EMERGENCY_BODY, dayHeader, directionDisplay,
// formatKmRound, todayIsoDate are imported from trip-brief-i18n.

function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
