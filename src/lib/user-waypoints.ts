/**
 * Personal waypoints and trip journal: data model and pure helpers.
 *
 * Both collections are the user's own annotations - small text records
 * persisted through the map store (localStorage), never uploaded anywhere.
 * Waypoints are dropped via map long-press / right-click; journal entries
 * are dated notes optionally attached to a km range (typically the stretch
 * hiked that day).
 */

import type { UnitSystem } from './types';
import { normalizeWaypointCategory, type WaypointCategoryId } from './waypoint-categories';

export interface UserWaypoint {
	id: string;
	lat: number;
	lng: number;
	name: string;
	note: string;
	/** Preset category controlling pin color and GPX export type/sym. */
	category?: WaypointCategoryId;
	/** ISO timestamp of creation. */
	createdAt: string;
	/** Snapped trail position in km from the SOBO start; null when the
	 *  waypoint sits too far from the route to snap meaningfully. */
	trailKm: number | null;
}

export interface JournalEntry {
	id: string;
	/** Calendar date (YYYY-MM-DD) the entry is about - editable, distinct
	 *  from createdAt so entries can be backfilled after the trip. */
	date: string;
	text: string;
	/** Optional km range the entry covers (SOBO-keyed, lo <= hi). */
	startKm?: number;
	endKm?: number;
	createdAt: string;
}

export function normalizeUserWaypoint(wp: UserWaypoint): UserWaypoint {
	return { ...wp, category: normalizeWaypointCategory(wp.category) };
}

export function newId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	return `wp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** "Waypoint 3" - first free index so deletions do not produce duplicates. */
export function nextWaypointName(existing: readonly UserWaypoint[], prefix: string): string {
	const taken = new Set(existing.map((w) => w.name));
	for (let i = 1; ; i++) {
		const candidate = `${prefix} ${i}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** Today's calendar date as YYYY-MM-DD in the device's timezone. */
export function todayIsoDate(): string {
	const d = new Date();
	const pad = (n: number): string => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface JournalExportLabels {
	title: string;
	/** Template for an attached range line; receives the formatted range. */
	rangeLine: (range: string) => string;
}

/** Plain-markdown journal export, newest entry last (chronological read).
 *  The km formatter is injected so the export stays unit-aware without this
 *  module importing the formatting layer. */
export function journalToMarkdown(
	entries: readonly JournalEntry[],
	labels: JournalExportLabels,
	formatKm: (km: number, units: UnitSystem) => string,
	units: UnitSystem,
): string {
	const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
	const parts: string[] = [`# ${labels.title}`, ''];
	for (const e of sorted) {
		parts.push(`## ${e.date}`);
		if (e.startKm !== undefined && e.endKm !== undefined) {
			parts.push(`<!-- cldt-journal-range:${e.startKm},${e.endKm} -->`);
			parts.push(labels.rangeLine(`${formatKm(e.startKm, units)} - ${formatKm(e.endKm, units)}`));
		}
		parts.push('', e.text.trim(), '');
	}
	return parts.join('\n');
}

/** Browser download of a small text file; mirrors downloadGpxFile but for
 *  arbitrary text content (journal markdown export). */
export function downloadTextFile(content: string, filename: string, mime = 'text/markdown'): void {
	const blob = new Blob([content], { type: `${mime};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	// Safari needs the URL alive until the click is processed.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
