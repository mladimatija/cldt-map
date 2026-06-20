/**
 * Assembles the plain-text "check-in" status message a hiker can send to a
 * contact through their OWN channel (system share sheet / messaging app). The
 * app never sends or tracks anything - this is pure string assembly. The caller
 * supplies already-localized and -formatted parts so this stays render-safe and
 * i18n-agnostic.
 */

export interface CheckinNoteLine {
	label: string;
	value: string;
}

export interface CheckinNoteInput {
	/** Localized status sentence, e.g. "Trail check-in - I'm OK." Becomes the first line. */
	statusLine: string;
	/** Labeled fact lines (position, accuracy, plus code, section, time); blank-value lines are dropped. */
	lines: CheckinNoteLine[];
	/** Optional free text the hiker added. */
	note?: string;
}

/** Builds the multi-line check-in message, dropping empty fact lines. */
export function buildCheckinNote(input: CheckinNoteInput): string {
	const out: string[] = [input.statusLine.trim()];

	const factLines = input.lines.filter((l) => l.value.trim().length > 0).map((l) => `${l.label}: ${l.value.trim()}`);
	if (factLines.length > 0) {
		out.push('', ...factLines);
	}

	const note = input.note?.trim();
	if (note) {
		out.push('', note);
	}

	return out.join('\n');
}
