/**
 * GPX export for journal entries linked to imported track segments.
 * Bundle zip uses dynamic fflate import to keep the main bundle lean.
 */
import { buildGpxXml, downloadGpxFile } from './gpx-export';
import { sliceTrackPoints } from './journal-track-link';
import type { ImportedTrack } from './store/types';
import { journalToMarkdown, type JournalEntry, type JournalExportLabels } from './user-waypoints';
import type { UnitSystem } from './types';

function sanitizeFilenamePart(value: string): string {
	return value
		.trim()
		.replace(/[^\w.-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 60);
}

export function journalEntryGpxFilename(entry: JournalEntry, trackName: string): string {
	const name = sanitizeFilenamePart(trackName || entry.date);
	return `cldt-journal-${entry.date}-${name}.gpx`;
}

export function buildJournalEntryGpx(entry: JournalEntry, track: ImportedTrack): string | null {
	if (!entry.trackLink) return null;
	const points = sliceTrackPoints(track, entry.trackLink);
	if (points.length === 0) return null;
	const gpxPoints = points.map((p) => ({
		lat: p.lat,
		lng: p.lng,
		...(p.ele !== undefined ? { elevation: p.ele } : {}),
	}));
	const label = `${entry.date} - ${entry.trackLink.trackName || track.name}`;
	return buildGpxXml(gpxPoints, label);
}

export function exportJournalEntryGpx(entry: JournalEntry, track: ImportedTrack): void {
	const xml = buildJournalEntryGpx(entry, track);
	if (!xml) return;
	downloadGpxFile(xml, journalEntryGpxFilename(entry, track.name));
}

function bundleGpxPath(link: NonNullable<JournalEntry['trackLink']>): string {
	return `gpx/${link.trackId}-${link.startIdx}-${link.endIdx}.gpx`;
}

export interface JournalBundleManifestEntry {
	date: string;
	gpx: string;
	trackId: string;
	startIdx: number;
	endIdx: number;
}

export interface JournalBundleManifest {
	version: 1;
	entries: JournalBundleManifestEntry[];
}

export async function exportJournalBundle(
	entries: readonly JournalEntry[],
	tracks: readonly ImportedTrack[],
	labels: JournalExportLabels,
	formatKm: (km: number, units: UnitSystem) => string,
	units: UnitSystem,
): Promise<void> {
	const { zipSync, strToU8 } = await import('fflate');
	const trackById = new Map(tracks.map((t) => [t.id, t]));
	const manifest: JournalBundleManifest = { version: 1, entries: [] };
	const files: Record<string, Uint8Array> = {};

	const md = journalToMarkdown(entries, labels, formatKm, units);
	files['cldt-journal/journal.md'] = strToU8(md);

	for (const entry of entries) {
		if (!entry.trackLink) continue;
		const track = trackById.get(entry.trackLink.trackId);
		if (!track) continue;
		const xml = buildJournalEntryGpx(entry, track);
		if (!xml) continue;
		const path = `cldt-journal/${bundleGpxPath(entry.trackLink)}`;
		files[path] = strToU8(xml);
		manifest.entries.push({
			date: entry.date,
			gpx: bundleGpxPath(entry.trackLink),
			trackId: entry.trackLink.trackId,
			startIdx: entry.trackLink.startIdx,
			endIdx: entry.trackLink.endIdx,
		});
	}

	files['cldt-journal/manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
	const zipped = zipSync(files);
	const blob = new Blob([zipped], { type: 'application/zip' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = 'cldt-journal-bundle.zip';
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
