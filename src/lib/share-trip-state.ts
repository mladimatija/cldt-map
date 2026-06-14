/**
 * Encode / decode trip-local state (stage plan, waypoints, journal, completion,
 * starred POIs) into a single compact `trip` query param on share URLs.
 */
import { useMapStore } from '@/lib/store';
import { getActiveStarredPoiIds, type StagePlan } from '@/lib/store/types';
import { SHARE_TARGET_MAX_LEN, SHARE_TRIP_PARAM_KEY } from '@/lib/share-url-constants';
import { newId, type JournalEntry, type UserWaypoint } from '@/lib/user-waypoints';
import { normalizeWaypointCategory } from '@/lib/waypoint-categories';

const POI_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MAX_WAYPOINTS = 50;
const MAX_JOURNAL_ENTRIES = 40;
const MAX_DONE_INTERVALS = 150;
const MAX_STARS = 80;
const MAX_WAYPOINT_NAME = 80;
const MAX_WAYPOINT_NOTE = 200;
const MAX_JOURNAL_TEXT = 400;

/** Compact wire format (short keys keep URLs within short-link limits). */
export interface ShareTripStatePayload {
	v: 1;
	sp?: {
		s: number;
		e: number;
		st: [number, number][];
		b: 'd' | 'e';
		sd?: string;
	};
	wp?: { i?: string; la: number; ln: number; n: string; no?: string; tk?: number | null; c?: string }[];
	j?: { d: string; t: string; s?: number; e?: number }[];
	done?: [number, number][];
	stars?: string[];
}

function roundKm(value: number): number {
	return Math.round(value * 100) / 100;
}

function trimText(value: string, maxLen: number): string {
	if (value.length <= maxLen) return value;
	return value.slice(0, maxLen);
}

function encodeBase64Url(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(encoded: string): string | null {
	if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
	try {
		const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
		const pad = '='.repeat((4 - (padded.length % 4)) % 4);
		const binary = atob(padded + pad);
		const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

function encodeStagePlan(plan: StagePlan): ShareTripStatePayload['sp'] {
	return {
		s: roundKm(plan.startKm),
		e: roundKm(plan.endKm),
		st: plan.stages.map((stage) => [roundKm(stage.startKm), roundKm(stage.endKm)]),
		b: plan.balanceMode === 'eta' ? 'e' : 'd',
		...(plan.startDate && ISO_DATE_RE.test(plan.startDate) && { sd: plan.startDate }),
	};
}

function encodeWaypoint(wp: UserWaypoint): NonNullable<ShareTripStatePayload['wp']>[number] {
	return {
		...(POI_ID_RE.test(wp.id) && { i: wp.id }),
		la: Math.round(wp.lat * 1e5) / 1e5,
		ln: Math.round(wp.lng * 1e5) / 1e5,
		n: trimText(wp.name, MAX_WAYPOINT_NAME),
		...(wp.note && { no: trimText(wp.note, MAX_WAYPOINT_NOTE) }),
		...(wp.trailKm !== null && { tk: roundKm(wp.trailKm) }),
		...(wp.category && wp.category !== 'generic' && { c: wp.category }),
	};
}

function encodeJournal(entry: JournalEntry): NonNullable<ShareTripStatePayload['j']>[number] {
	return {
		d: entry.date,
		t: trimText(entry.text, MAX_JOURNAL_TEXT),
		...(entry.startKm !== undefined && { s: roundKm(entry.startKm) }),
		...(entry.endKm !== undefined && { e: roundKm(entry.endKm) }),
	};
}

/** Read current trip-local fields from the map store. Returns null when empty. */
export function collectShareTripStateFromStore(): ShareTripStatePayload | null {
	const state = useMapStore.getState();
	const payload: ShareTripStatePayload = { v: 1 };
	let hasAny = false;

	if (state.stagePlan && state.stagePlan.stages.length > 0) {
		payload.sp = encodeStagePlan(state.stagePlan);
		hasAny = true;
	}
	if (state.userWaypoints.length > 0) {
		payload.wp = state.userWaypoints.slice(0, MAX_WAYPOINTS).map(encodeWaypoint);
		hasAny = true;
	}
	if (state.journalEntries.length > 0) {
		payload.j = state.journalEntries.slice(0, MAX_JOURNAL_ENTRIES).map(encodeJournal);
		hasAny = true;
	}
	if (state.completedIntervals.length > 0) {
		payload.done = state.completedIntervals
			.slice(0, MAX_DONE_INTERVALS)
			.map((iv) => [roundKm(iv.startKm), roundKm(iv.endKm)]);
		hasAny = true;
	}
	// Export only the active starred collection as a flat `stars` array so share
	// URLs stay backward compatible. Import resets to a single default collection.
	const starred = getActiveStarredPoiIds(state);
	if (starred.size > 0) {
		const stars = [...starred].filter((id) => POI_ID_RE.test(id)).slice(0, MAX_STARS);
		if (stars.length > 0) {
			payload.stars = stars;
			hasAny = true;
		}
	}

	return hasAny ? payload : null;
}

function maxTripParamLen(url: URL): number {
	const clone = new URL(url.toString());
	clone.searchParams.delete(SHARE_TRIP_PARAM_KEY);
	const overhead = SHARE_TRIP_PARAM_KEY.length + 1;
	return Math.max(0, SHARE_TARGET_MAX_LEN - clone.search.length - overhead);
}

function compactPayloadForUrl(payload: ShareTripStatePayload, maxLen: number): ShareTripStatePayload | null {
	let current: ShareTripStatePayload = { ...payload };

	const tryEncode = (): string | null => {
		const json = JSON.stringify(current);
		if (json.length > 8000) return null;
		return encodeBase64Url(json);
	};

	let encoded = tryEncode();
	if (encoded && encoded.length <= maxLen) return current;

	if (current.j?.length) {
		current = {
			...current,
			j: current.j.map((entry) => ({ ...entry, t: trimText(entry.t, 120) })),
		};
		encoded = tryEncode();
		if (encoded && encoded.length <= maxLen) return current;

		const trimmedJournal = current.j?.slice(0, 15);
		if (trimmedJournal?.length) {
			current = { ...current, j: trimmedJournal };
			encoded = tryEncode();
			if (encoded && encoded.length <= maxLen) return current;
		}

		const { j: _j, ...withoutJournal } = current;
		current = withoutJournal;
		encoded = tryEncode();
		if (encoded && encoded.length <= maxLen) return current;
	}

	if (current.wp?.length) {
		current = { ...current, wp: current.wp.slice(0, 20) };
		encoded = tryEncode();
		if (encoded && encoded.length <= maxLen) return current;

		const { wp: _wp, ...withoutWaypoints } = current;
		current = withoutWaypoints;
		encoded = tryEncode();
		if (encoded && encoded.length <= maxLen) return current;
	}

	if (current.done?.length) {
		current = { ...current, done: current.done.slice(0, 50) };
		encoded = tryEncode();
		if (encoded && encoded.length <= maxLen) return current;
	}

	return encoded && encoded.length <= maxLen ? current : null;
}

/** Append a `trip` param when the store holds shareable trip-local state. */
export function appendShareTripStateToUrl(url: URL): void {
	const payload = collectShareTripStateFromStore();
	if (!payload) return;

	const maxLen = maxTripParamLen(url);
	if (maxLen < 32) return;

	const compact = compactPayloadForUrl(payload, maxLen);
	if (!compact) return;

	const encoded = encodeBase64Url(JSON.stringify(compact));
	if (encoded.length > maxLen) return;

	url.searchParams.set(SHARE_TRIP_PARAM_KEY, encoded);
}

function parseStagePlan(raw: unknown): StagePlan | null {
	if (!raw || typeof raw !== 'object') return null;
	const sp = raw as ShareTripStatePayload['sp'];
	if (!sp || typeof sp.s !== 'number' || typeof sp.e !== 'number' || !Array.isArray(sp.st)) return null;
	if (!Number.isFinite(sp.s) || !Number.isFinite(sp.e) || sp.st.length === 0) return null;

	const stages = sp.st
		.map((pair) => {
			if (!Array.isArray(pair) || pair.length !== 2) return null;
			const [startKm, endKm] = pair;
			if (!Number.isFinite(startKm) || !Number.isFinite(endKm) || endKm <= startKm) return null;
			return { startKm: roundKm(startKm), endKm: roundKm(endKm) };
		})
		.filter((stage): stage is { startKm: number; endKm: number } => stage !== null);

	if (stages.length === 0) return null;

	return {
		startKm: roundKm(sp.s),
		endKm: roundKm(sp.e),
		stages,
		balanceMode: sp.b === 'e' ? 'eta' : 'distance',
		...(sp.sd && ISO_DATE_RE.test(sp.sd) && { startDate: sp.sd }),
	};
}

function parseWaypoints(raw: unknown): UserWaypoint[] {
	if (!Array.isArray(raw)) return [];
	const now = new Date().toISOString();
	const result: UserWaypoint[] = [];

	for (const item of raw.slice(0, MAX_WAYPOINTS)) {
		if (!item || typeof item !== 'object') continue;
		const wp = item as NonNullable<ShareTripStatePayload['wp']>[number];
		if (typeof wp.la !== 'number' || typeof wp.ln !== 'number' || typeof wp.n !== 'string') continue;
		if (!Number.isFinite(wp.la) || !Number.isFinite(wp.ln)) continue;
		const id = typeof wp.i === 'string' && POI_ID_RE.test(wp.i) && !result.some((w) => w.id === wp.i) ? wp.i : newId();
		const category = normalizeWaypointCategory(typeof wp.c === 'string' ? wp.c : undefined);
		result.push({
			id,
			lat: wp.la,
			lng: wp.ln,
			name: trimText(wp.n, MAX_WAYPOINT_NAME),
			note: wp.no ? trimText(wp.no, MAX_WAYPOINT_NOTE) : '',
			trailKm: wp.tk !== undefined && wp.tk !== null && Number.isFinite(wp.tk) ? roundKm(wp.tk) : null,
			category,
			createdAt: now,
		});
	}

	return result;
}

function parseJournal(raw: unknown): JournalEntry[] {
	if (!Array.isArray(raw)) return [];
	const now = new Date().toISOString();
	const result: JournalEntry[] = [];

	for (const item of raw.slice(0, MAX_JOURNAL_ENTRIES)) {
		if (!item || typeof item !== 'object') continue;
		const entry = item as NonNullable<ShareTripStatePayload['j']>[number];
		if (typeof entry.d !== 'string' || typeof entry.t !== 'string') continue;
		if (!ISO_DATE_RE.test(entry.d)) continue;
		result.push({
			id: newId(),
			date: entry.d,
			text: trimText(entry.t, MAX_JOURNAL_TEXT),
			...(entry.s !== undefined && Number.isFinite(entry.s) && { startKm: roundKm(entry.s) }),
			...(entry.e !== undefined && Number.isFinite(entry.e) && { endKm: roundKm(entry.e) }),
			createdAt: now,
		});
	}

	return result;
}

function parseDone(raw: unknown): [number, number][] {
	if (!Array.isArray(raw)) return [];
	const result: [number, number][] = [];
	for (const item of raw.slice(0, MAX_DONE_INTERVALS)) {
		if (!Array.isArray(item) || item.length !== 2) continue;
		const [startKm, endKm] = item;
		if (!Number.isFinite(startKm) || !Number.isFinite(endKm) || endKm <= startKm) continue;
		result.push([roundKm(startKm), roundKm(endKm)]);
	}
	return result;
}

function parseStars(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((id): id is string => typeof id === 'string' && POI_ID_RE.test(id)).slice(0, MAX_STARS);
}

/** Decode a `trip` query value. Returns null on missing or invalid input. */
export function parseShareTripStateParam(raw: string | null): ShareTripStatePayload | null {
	if (!raw) return null;
	const json = decodeBase64Url(raw);
	if (!json) return null;
	try {
		const parsed = JSON.parse(json) as ShareTripStatePayload;
		if (parsed?.v !== 1) return null;
		return parsed;
	} catch {
		return null;
	}
}

/** Apply decoded trip state to the map store (replaces existing trip-local data). */
export function applyShareTripState(payload: ShareTripStatePayload): void {
	const store = useMapStore.getState();

	const stagePlan = payload.sp ? parseStagePlan(payload.sp) : null;
	if (stagePlan) {
		store.setStagePlan(stagePlan);
	}

	const waypoints = payload.wp ? parseWaypoints(payload.wp) : [];
	for (const wp of [...store.userWaypoints]) {
		store.removeUserWaypoint(wp.id);
	}
	for (const wp of waypoints) {
		store.addUserWaypoint(wp);
	}

	const journal = payload.j ? parseJournal(payload.j) : [];
	for (const entry of [...store.journalEntries]) {
		store.removeJournalEntry(entry.id);
	}
	for (const entry of journal) {
		store.addJournalEntry(entry);
	}

	if (payload.done) {
		store.clearCompletion();
		for (const [startKm, endKm] of parseDone(payload.done)) {
			store.markCompleted(startKm, endKm);
		}
	}

	if (payload.stars) {
		// Drop every existing collection so multi-list state cannot drift from the
		// flat `stars` array in the URL (export carries the active list only).
		store.importStarredPoisFromShare(parseStars(payload.stars));
	}
}
