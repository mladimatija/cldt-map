/**
 * Trip-brief AI narrative generation.
 *
 * Accepts a compact, validated outline of the user's stage plan (km ranges,
 * elevation, ETA, place names, seasonal alerts, optional forecast) and asks
 * Claude for a short guidebook-style paragraph per day plus a trip overview,
 * in the brief's locale. The model is instructed to use ONLY the provided
 * facts - no invented trail conditions. Structured outputs fix the reply's
 * shape; the day count, which a schema cannot express, is checked here.
 *
 * Privacy: the request carries plan facts only (no GPS fixes, no identifiers
 * beyond the calling IP that any HTTP request exposes). The Anthropic API key
 * lives in the deploy environment (ANTHROPIC_API_KEY); when it is absent the
 * route answers 503 and the client silently keeps the templated narratives,
 * as it does for any failure here.
 */
import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, readBodyWithCap } from '@/lib/api-defense';
import { LOCALES as APP_LOCALES } from '@/i18n/routing';

/** Sonnet for prose quality. An override must support structured outputs. */
const MODEL = process.env.NARRATIVE_MODEL || 'claude-sonnet-5-5';
const UPSTREAM_TIMEOUT_MS = 45_000;
/** Room for the model's thinking plus a 31-day brief in Croatian or German. */
const MAX_TOKENS = 16_000;
/** The outline for a 31-day plan is a few KB; anything bigger is hostile. */
const MAX_BODY_BYTES = 64_000;

/** The reply shape structured outputs enforce. */
const NARRATIVE_SCHEMA = {
	type: 'object',
	properties: {
		overview: { type: 'string', description: 'A 2-3 sentence overview of the whole trip.' },
		days: {
			type: 'array',
			items: { type: 'string' },
			description: 'One 2-3 sentence narrative per day, in day order.',
		},
	},
	required: ['overview', 'days'],
	additionalProperties: false,
};

const MAX_DAYS = 31;
const MAX_STR = 160;
const MAX_POIS_PER_DAY = 8;
const MAX_ALERTS_PER_DAY = 4;
/** Per-narrative output cap, characters. Anything longer is a runaway. */
const MAX_NARRATIVE_CHARS = 700;

const LOCALES = new Set<string>(APP_LOCALES);
const LANGUAGE_NAMES: Record<string, string> = {
	en: 'English',
	hr: 'Croatian',
	de: 'German',
	it: 'Italian',
};

interface NarrativeDayInput {
	day: number;
	kmRange: string;
	distanceLabel: string;
	gainM: number;
	lossM: number;
	etaLabel: string;
	poiNames: string[];
	alerts: string[];
	forecast?: string;
}

interface NarrativeRequest {
	locale: string;
	directionLabel: string;
	totalDistanceLabel: string;
	etaLabel: string;
	days: NarrativeDayInput[];
}

function str(v: unknown, max = MAX_STR): string | null {
	if (typeof v !== 'string') return null;
	const t = v.trim();
	if (t.length === 0 || t.length > max) return null;
	return t;
}

function num(v: unknown, lo: number, hi: number): number | null {
	return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

function strList(v: unknown, maxItems: number): string[] | null {
	if (!Array.isArray(v) || v.length > maxItems) return null;
	const out: string[] = [];
	for (const item of v) {
		const s = str(item);
		if (s === null) return null;
		out.push(s);
	}
	return out;
}

/** Strict shape validation: reject anything that is not exactly the compact
 *  outline the client sends, so the prompt cannot be smuggled extra content. */
function parseRequest(raw: unknown): NarrativeRequest | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const locale = str(o.locale, 5);
	if (!locale || !LOCALES.has(locale)) return null;
	const directionLabel = str(o.directionLabel);
	const totalDistanceLabel = str(o.totalDistanceLabel);
	const etaLabel = str(o.etaLabel);
	if (!directionLabel || !totalDistanceLabel || !etaLabel) return null;
	if (!Array.isArray(o.days) || o.days.length === 0 || o.days.length > MAX_DAYS) return null;

	const days: NarrativeDayInput[] = [];
	for (const rawDay of o.days) {
		if (!rawDay || typeof rawDay !== 'object') return null;
		const d = rawDay as Record<string, unknown>;
		const day = num(d.day, 1, MAX_DAYS);
		const kmRange = str(d.kmRange);
		const distanceLabel = str(d.distanceLabel);
		const gainM = num(d.gainM, 0, 30_000);
		const lossM = num(d.lossM, 0, 30_000);
		const etaLabelDay = str(d.etaLabel);
		const poiNames = strList(d.poiNames, MAX_POIS_PER_DAY);
		const alerts = strList(d.alerts, MAX_ALERTS_PER_DAY);
		const forecast = d.forecast === undefined ? undefined : str(d.forecast);
		if (
			day === null ||
			!kmRange ||
			!distanceLabel ||
			gainM === null ||
			lossM === null ||
			!etaLabelDay ||
			poiNames === null ||
			alerts === null ||
			forecast === null
		) {
			return null;
		}
		days.push({ day, kmRange, distanceLabel, gainM, lossM, etaLabel: etaLabelDay, poiNames, alerts, forecast });
	}
	return { locale, directionLabel, totalDistanceLabel, etaLabel, days };
}

function buildPrompt(req: NarrativeRequest): string {
	const lines: string[] = [];
	lines.push(
		`Trip: Croatian Long Distance Trail (CLDT), walking ${req.directionLabel}. ` +
			`Total ${req.totalDistanceLabel} over ${req.days.length} days; estimated walking time ${req.etaLabel}.`,
	);
	for (const d of req.days) {
		const parts = [
			`Day ${d.day}: trail km ${d.kmRange}, ${d.distanceLabel}, ascent ${Math.round(d.gainM)} m, descent ${Math.round(d.lossM)} m, walking time ${d.etaLabel}.`,
		];
		if (d.poiNames.length > 0) parts.push(`Places along the way: ${d.poiNames.join('; ')}.`);
		if (d.alerts.length > 0) parts.push(`Active warnings: ${d.alerts.join('; ')}.`);
		if (d.forecast) parts.push(`Forecast: ${d.forecast}.`);
		lines.push(parts.join(' '));
	}
	lines.push(`Write exactly ${req.days.length} day narratives, one per day in order, and the overview.`);
	return lines.join('\n');
}

function systemPrompt(locale: string): string {
	return (
		`You write concise day-by-day narratives for a long-distance hiking trip brief. ` +
		`Write in ${LANGUAGE_NAMES[locale]}. For each day write 2-3 sentences in a warm, practical hiking-guide tone: ` +
		`characterize the day's effort from the distance and elevation figures, mention the most notable places by name ` +
		`when provided, and weave in any warnings or forecast naturally. Also write a 2-3 sentence trip overview. ` +
		`STRICT RULES: use only the facts given - never invent terrain details, place facts, conditions, or services. ` +
		`Do not repeat raw numbers the reader already sees in the stats line more than once per day. ` +
		`Use a regular hyphen-minus, never em or en dashes.`
	);
}

export async function POST(request: NextRequest): Promise<Response> {
	const limited = await enforceRateLimit(request, { name: 'narrative', windowMs: 600_000, max: 6 });
	if (limited) return limited;

	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		return NextResponse.json({ error: 'Narrative generation is not configured' }, { status: 503 });
	}

	const body = await readBodyWithCap(request, MAX_BODY_BYTES);
	if (body === null) {
		return NextResponse.json({ error: 'Request too large' }, { status: 413 });
	}

	let req: NarrativeRequest | null = null;
	try {
		req = parseRequest(JSON.parse(body));
	} catch {
		// fall through to the 400 below
	}
	if (!req) {
		return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
	}

	const client = new Anthropic({ apiKey, timeout: UPSTREAM_TIMEOUT_MS, maxRetries: 1 });
	try {
		const response = await client.beta.messages.create({
			model: MODEL,
			max_tokens: MAX_TOKENS,
			// A policy decline is retried server-side on the model's default fallback.
			betas: ['server-side-fallback-2026-07-01'],
			fallbacks: 'default',
			output_config: { effort: 'low', format: { type: 'json_schema', schema: NARRATIVE_SCHEMA } },
			system: systemPrompt(req.locale),
			messages: [{ role: 'user', content: buildPrompt(req) }],
		});

		if (response.stop_reason === 'max_tokens' || response.stop_reason === 'refusal') {
			const category = response.stop_details?.category;
			console.error(`[narrative] stop_reason ${response.stop_reason}${category ? ` (${category})` : ''}`);
			return NextResponse.json({ error: 'Narrative generation failed' }, { status: 502 });
		}

		const text = response.content.find((block) => block.type === 'text')?.text ?? '';
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = null;
		}
		const narratives = validateNarratives(parsed, req.days.length);
		if (!narratives) {
			console.error('[narrative] model response failed validation');
			return NextResponse.json({ error: 'Narrative generation failed' }, { status: 502 });
		}
		return NextResponse.json(narratives);
	} catch (err) {
		if (err instanceof Anthropic.APIConnectionTimeoutError) {
			return NextResponse.json({ error: 'Narrative generation timed out' }, { status: 504 });
		}
		// Busy upstream (rate limited or overloaded): a later try may work.
		if (err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && err.status === 529)) {
			return NextResponse.json({ error: 'Narrative generation is busy' }, { status: 503 });
		}
		const status = err instanceof Anthropic.APIError ? ` ${err.status ?? ''}` : '';
		console.error(`[narrative] upstream error${status}:`, err instanceof Error ? err.message : String(err));
		return NextResponse.json({ error: 'Narrative generation failed' }, { status: 502 });
	}
}

/** Enforces exactly one non-empty, length-capped string per day plus an
 *  overview. Em/en dashes are normalized to plain hyphens as a final guarantee. */
function validateNarratives(parsed: unknown, dayCount: number): { overview: string; days: string[] } | null {
	if (!parsed || typeof parsed !== 'object') return null;
	const o = parsed as { overview?: unknown; days?: unknown };
	const clean = (v: unknown): string | null => {
		if (typeof v !== 'string') return null;
		const t = v.replace(/[\u2013\u2014]/g, '-').trim();
		return t.length > 0 && t.length <= MAX_NARRATIVE_CHARS ? t : null;
	};
	const overview = clean(o.overview);
	if (!overview || !Array.isArray(o.days) || o.days.length !== dayCount) return null;
	const days: string[] = [];
	for (const d of o.days) {
		const s = clean(d);
		if (!s) return null;
		days.push(s);
	}
	return { overview, days };
}
