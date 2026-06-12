/**
 * iCalendar (.ics) export for multi-day stage plans.
 *
 * Emits one all-day VEVENT per stage when the plan carries a trip start date
 * (stage N maps to startDate + N calendar days). Pure string builder - no
 * dependencies, runs fully client-side.
 */

import { siteMetadata } from '@/lib/metadata';

export interface StageIcalEventInput {
	/** Calendar date for this stage (yyyy-mm-dd). */
	date: string;
	summary: string;
	description: string;
	/** Stable id; defaults to a date + summary hash when omitted. */
	uid?: string;
}

/** Escape text for iCalendar property values (RFC 5545). */
function escapeIcalText(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** Fold a content line at 75 octets with CRLF + space continuation. */
function foldPropertyLine(line: string): string {
	if (line.length <= 75) return line;
	const parts: string[] = [line.slice(0, 75)];
	let rest = line.slice(75);
	while (rest.length > 0) {
		parts.push(` ${rest.slice(0, 74)}`);
		rest = rest.slice(74);
	}
	return parts.join('\r\n');
}

function formatIcalUtcStamp(d = new Date()): string {
	return d
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}Z$/, 'Z');
}

function toIcalDate(iso: string): string {
	return iso.replace(/-/g, '');
}

function addDays(isoDate: string, days: number): string {
	const d = new Date(`${isoDate}T12:00:00`);
	d.setDate(d.getDate() + days);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Calendar date for stage index (0-based) given the trip start date. */
export function stageCalendarDate(startDate: string, stageIndex: number): string {
	return addDays(startDate, stageIndex);
}

function defaultUid(date: string, index: number): string {
	return `cldt-stage-${date}-${index}@map.cldt.hr`;
}

/** Build a VCALENDAR document with one all-day event per stage. */
export function buildStagePlanIcs(events: StageIcalEventInput[], calendarName: string): string {
	const stamp = formatIcalUtcStamp();
	const lines: string[] = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//CLDT Map//Stage Planner//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		foldPropertyLine(`X-WR-CALNAME:${escapeIcalText(calendarName)}`),
	];

	for (let i = 0; i < events.length; i++) {
		const event = events[i];
		const start = toIcalDate(event.date);
		const end = toIcalDate(addDays(event.date, 1));
		const uid = event.uid ?? defaultUid(event.date, i);
		lines.push('BEGIN:VEVENT');
		lines.push(foldPropertyLine(`UID:${uid}`));
		lines.push(foldPropertyLine(`DTSTAMP:${stamp}`));
		lines.push(`DTSTART;VALUE=DATE:${start}`);
		lines.push(`DTEND;VALUE=DATE:${end}`);
		lines.push(foldPropertyLine(`SUMMARY:${escapeIcalText(event.summary)}`));
		lines.push(foldPropertyLine(`DESCRIPTION:${escapeIcalText(event.description)}`));
		lines.push(foldPropertyLine(`URL:${siteMetadata.url}`));
		lines.push('END:VEVENT');
	}

	lines.push('END:VCALENDAR');
	return `${lines.join('\r\n')}\r\n`;
}

/** Trigger a browser download for the given ICS content. */
export function downloadIcsFile(content: string, filename: string): void {
	const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
