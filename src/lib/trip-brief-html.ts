/**
 * HTML generator for the trip brief. Produces a single self-contained file
 * (inline CSS, data-URL images) suited for reading on a phone browser or
 * saving for offline use. Same sections as the PDF/DOCX exporters; map
 * snapshots are omitted to keep the export fast and the file lightweight.
 */

import { formatEta } from '@/lib/distance-utils';
import { siteMetadata } from '@/lib/metadata';
import type { TripBrief, TripBriefDay } from '@/lib/trip-brief';
import {
	dayDateLabel,
	dayHeader,
	directionDisplay,
	emergencyLines,
	formatGeneratedAt,
	formatKmRound,
	todayIsoDate,
} from '@/lib/trip-brief-i18n';
import { formatElevation } from '@/lib/utils';

const MAX_POIS_PER_DAY = 25;

export interface TripBriefHtmlArgs {
	brief: TripBrief;
	onProgress?: (current: number, total: number) => void;
	signal?: AbortSignal;
}

/** Build the HTML document string (does not trigger download). */
export function buildTripBriefHtml(brief: TripBrief): string {
	const { meta, days } = brief;
	const lang = meta.locale;
	const title = escapeHtml(meta.title);

	const sections: string[] = [];

	sections.push(buildCoverSection(brief));

	for (const day of days) {
		sections.push(buildDaySection(brief, day));
	}

	if (meta.gearChecklist) {
		sections.push(buildGearSection(brief));
	}

	sections.push(buildEmergencySection(brief));

	return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${TRIP_BRIEF_CSS}
</style>
</head>
<body>
<header class="site-header">
  <p class="site-name">${escapeHtml(siteMetadata.companyShortName)} Map</p>
  <h1>${title}</h1>
  <p class="generated">${escapeHtml(meta.strings.labels.generated)} ${escapeHtml(formatGeneratedAt(meta.generatedAt, meta.locale))}</p>
</header>
<main>
${sections.join('\n')}
</main>
<footer class="site-footer">
  <p><a href="${escapeHtml(siteMetadata.url)}">${escapeHtml(siteMetadata.url)}</a></p>
</footer>
</body>
</html>`;
}

/** Render HTML and trigger a browser download. */
export async function exportTripBriefHtml(args: TripBriefHtmlArgs): Promise<void> {
	const { brief, onProgress, signal } = args;
	const totalSteps = 2;
	if (signal?.aborted) return;
	onProgress?.(1, totalSteps);
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	if (signal?.aborted) return;
	const html = buildTripBriefHtml(brief);
	onProgress?.(2, totalSteps);
	downloadHtmlFile(html, `cldt-trip-brief-${todayIsoDate()}.html`);
}

function buildCoverSection(brief: TripBrief): string {
	const { meta, overview } = brief;
	const rows: [string, string][] = [
		[meta.strings.labels.totalDistance, formatKmRound(overview.totalKm, meta.units)],
		[meta.strings.labels.dayCount, `${overview.dayCount}`],
		[meta.strings.labels.direction, directionDisplay(meta.direction, meta.strings)],
		[meta.strings.labels.gain, `+${formatElevation(overview.totalGainM, meta.units)}`],
		[meta.strings.labels.loss, `-${formatElevation(overview.totalLossM, meta.units)}`],
		[meta.strings.labels.eta, formatEta(overview.totalDurationSec)],
		[meta.strings.labels.pace, `${meta.walkingPaceKmh.toFixed(1)} km/h`],
		...(meta.packSummary ? [[meta.strings.labels.pack, meta.packSummary] as [string, string]] : []),
		...(meta.resupplySummary ? [[meta.strings.labels.resupplyCadence, meta.resupplySummary] as [string, string]] : []),
	];

	const grid = rows
		.map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
		.join('\n');

	const disclaimer = meta.aiDisclaimer ? `<p class="disclaimer">${escapeHtml(meta.aiDisclaimer)}</p>` : '';

	return `<section class="brief-section" id="overview">
  <h2>${escapeHtml(meta.strings.labels.overview)}</h2>
  <table class="stats-table">${grid}</table>
  <p class="narrative">${escapeHtml(overview.narrative)}</p>
  ${disclaimer}
</section>`;
}

function buildDaySection(brief: TripBrief, day: TripBriefDay): string {
	const { meta } = brief;
	const dateLabel = dayDateLabel(day, meta.locale);

	// Rest days: heading + optional date + body. No map / stats / elevation /
	// POIs - a rest day has no km bounds.
	if (day.kind === 'rest') {
		const dateLine = dateLabel ? `<p class="day-date">${escapeHtml(dateLabel)}</p>` : '';
		return `<section class="brief-section day-section" id="day-${escapeHtml(day.dayId)}">
  <h2>${escapeHtml(meta.strings.restDay.heading)}</h2>
  ${dateLine}
  <p class="narrative">${escapeHtml(day.narrative)}</p>
</section>`;
	}

	const distKm = day.endKm - day.startKm;
	const header = dayHeader(day, meta.strings, meta.units);
	const gainStr = formatElevation(day.gainM, meta.units);
	const lossStr = formatElevation(day.lossM, meta.units);
	const etaStr = formatEta(day.etaSec);

	const elevBlock = day.elevationThumb
		? `<img class="elevation-thumb" src="${day.elevationThumb}" alt="" loading="lazy">`
		: '';

	const packBlock = [
		day.packBaseLabel ? `<p class="water-carry">${escapeHtml(day.packBaseLabel)}</p>` : '',
		day.packLoadedLabel ? `<p class="water-carry">${escapeHtml(day.packLoadedLabel)}</p>` : '',
	].join('');

	const resupplyBlock = [day.resupplyEnteringLabel, day.resupplyCarryLabel, day.foodPackLabel]
		.filter((line): line is string => !!line)
		.map((line) => `<p class="resupply-carry">${escapeHtml(line)}</p>`)
		.join('');

	let alertsBlock = '';
	if (day.seasonalAlerts.length > 0) {
		const items = day.seasonalAlerts
			.map((a) => `<li><strong>[${escapeHtml(a.severity)}]</strong> ${escapeHtml(a.title)}</li>`)
			.join('\n');
		alertsBlock = `<h3>${escapeHtml(meta.strings.labels.alerts)}</h3><ul class="alerts">${items}</ul>`;
	}

	let poisBlock = '';
	if (day.pois.length > 0) {
		const visible = day.pois.slice(0, MAX_POIS_PER_DAY);
		const remainder = day.pois.length - visible.length;
		const items = visible
			.map((poi) => {
				const offTrail =
					poi.distanceFromTrailKm >= 0.5
						? ` · ${escapeHtml(formatKmRound(poi.distanceFromTrailKm, meta.units))} off-trail`
						: '';
				const resupply = poi.resupply ? ` · ${escapeHtml(meta.strings.labels.resupply)}` : '';
				const metaLine = `${escapeHtml(poi.typeLabel)} · km ${poi.trailKm.toFixed(0)}${offTrail}${resupply}`;
				const thumb = poi.thumbUrl
					? `<img class="poi-thumb" src="${escapeHtml(poi.thumbUrl)}" alt="" loading="lazy">`
					: '';
				const summary = poi.summary ? `<p class="poi-summary">${escapeHtml(poi.summary)}</p>` : '';
				const name = poi.wikipediaUrl
					? `<a href="${escapeHtml(poi.wikipediaUrl)}" rel="noopener noreferrer">${escapeHtml(poi.name)}</a>`
					: escapeHtml(poi.name);
				return `<li class="poi-item">${thumb}<div class="poi-body"><p class="poi-name">${name}</p><p class="poi-meta">${metaLine}</p>${summary}</div></li>`;
			})
			.join('\n');
		const more = remainder > 0 ? `<p class="poi-more">+ ${remainder} ${escapeHtml(meta.strings.moreLabel)}</p>` : '';
		poisBlock = `<h3>${escapeHtml(meta.strings.labels.pois)} (${day.pois.length})</h3><ul class="poi-list">${items}</ul>${more}`;
	}

	const dateLine = dateLabel ? `<p class="day-date">${escapeHtml(dateLabel)}</p>` : '';

	return `<section class="brief-section day-section" id="day-${escapeHtml(day.dayId)}">
  <h2>${escapeHtml(header)}</h2>
  ${dateLine}
  <p class="day-stats">
    <span class="stat-gain">+${escapeHtml(gainStr)}</span>
    <span class="stat-loss">-${escapeHtml(lossStr)}</span>
    <span class="stat-eta">${escapeHtml(etaStr)}</span>
    <span class="stat-dist">${escapeHtml(formatKmRound(distKm, meta.units))}</span>
  </p>
  ${elevBlock}
  <p class="narrative">${escapeHtml(day.narrative)}</p>
  ${packBlock}
  ${resupplyBlock}
  ${alertsBlock}
  ${poisBlock}
</section>`;
}

function buildGearSection(brief: TripBrief): string {
	const gear = brief.meta.gearChecklist;
	if (!gear) return '';
	const missing = gear.missingLine ? `<p class="gear-missing">${escapeHtml(gear.missingLine)}</p>` : '';
	const categories = gear.categories
		.map((cat) => {
			const lines = cat.lines.map((line) => `<li>${escapeHtml(`[ ] ${line}`)}</li>`).join('\n');
			return `<div class="gear-category"><h3>${escapeHtml(cat.name)}</h3><ul>${lines}</ul></div>`;
		})
		.join('\n');
	return `<section class="brief-section" id="gear">
  <h2>${escapeHtml(gear.heading)}</h2>
  ${missing}
  <div class="gear-grid">${categories}</div>
</section>`;
}

function buildEmergencySection(brief: TripBrief): string {
	const { meta } = brief;
	const lines = emergencyLines(meta.strings)
		.map((line) => `<p>${escapeHtml(line)}</p>`)
		.join('\n');
	return `<section class="brief-section" id="emergency">
  <h2>${escapeHtml(meta.strings.labels.emergency)}</h2>
  ${lines}
</section>`;
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function downloadHtmlFile(content: string, filename: string): void {
	const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

const TRIP_BRIEF_CSS = `
:root {
  color-scheme: light;
  --text: #1f2937;
  --muted: #6b7280;
  --border: #e5e7eb;
  --accent: #0369a1;
  --gain: #16a34a;
  --loss: #ef4444;
  --alert: #c2410c;
  --bg: #ffffff;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
}
.site-header, .site-footer, .brief-section {
  max-width: 42rem;
  margin: 0 auto;
  padding: 1rem 1.25rem;
}
.site-header { border-bottom: 1px solid var(--border); }
.site-header h1 { margin: 0.25rem 0; font-size: 1.5rem; color: var(--accent); }
.site-name { margin: 0; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.generated { margin: 0.5rem 0 0; font-size: 0.875rem; color: var(--muted); font-style: italic; }
.site-footer { border-top: 1px solid var(--border); font-size: 0.875rem; color: var(--muted); text-align: center; }
.site-footer a { color: var(--accent); }
.brief-section { border-bottom: 1px solid var(--border); }
.brief-section h2 { margin: 0 0 0.75rem; font-size: 1.125rem; color: var(--accent); }
.brief-section h3 { margin: 1rem 0 0.5rem; font-size: 1rem; }
.stats-table { width: 100%; border-collapse: collapse; font-size: 0.9375rem; }
.stats-table th { text-align: left; padding: 0.35rem 0.75rem 0.35rem 0; font-weight: 600; vertical-align: top; white-space: nowrap; }
.stats-table td { padding: 0.35rem 0; }
.narrative { color: var(--muted); font-style: italic; margin: 0.75rem 0 0; }
.disclaimer { font-size: 0.8125rem; color: var(--muted); font-style: italic; margin-top: 0.75rem; }
.day-date { margin: -0.25rem 0 0.5rem; font-size: 0.8125rem; color: var(--muted); }
.day-stats { display: flex; flex-wrap: wrap; gap: 0.75rem; font-size: 0.9375rem; font-weight: 600; margin: 0 0 0.75rem; }
.stat-gain { color: var(--gain); }
.stat-loss { color: var(--loss); }
.stat-eta, .stat-dist { color: var(--muted); font-weight: 500; }
.elevation-thumb { display: block; width: 100%; max-width: 100%; height: auto; margin: 0.5rem 0; border-radius: 4px; }
.water-carry { color: #0e7490; font-size: 0.9375rem; margin: 0.5rem 0; }
.alerts { margin: 0; padding-left: 1.25rem; color: var(--alert); }
.alerts li { margin-bottom: 0.35rem; }
.poi-list { list-style: none; margin: 0; padding: 0; }
.poi-item { display: flex; gap: 0.75rem; margin-bottom: 0.75rem; align-items: flex-start; }
.poi-thumb { width: 3.5rem; height: 3.5rem; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
.poi-body { min-width: 0; flex: 1; }
.poi-name { margin: 0; font-weight: 600; }
.poi-name a { color: var(--accent); text-decoration: none; }
.poi-meta { margin: 0.15rem 0 0; font-size: 0.8125rem; color: var(--muted); }
.poi-summary { margin: 0.25rem 0 0; font-size: 0.8125rem; color: var(--muted); }
.poi-more { font-size: 0.8125rem; color: var(--muted); margin: 0.5rem 0 0; }
.gear-missing { color: var(--alert); font-weight: 600; font-size: 0.9375rem; }
.gear-grid { display: grid; gap: 1rem; }
@media (min-width: 36rem) {
  .gear-grid { grid-template-columns: 1fr 1fr; }
}
.gear-category ul { margin: 0; padding-left: 1.25rem; font-size: 0.875rem; }
#emergency p { margin: 0 0 0.75rem; }
`;
