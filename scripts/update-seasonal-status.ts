// Curates public/seasonal-status.json from live Croatian trail-status sources.
//
// Run: `npm run update-seasonal`
// Requires: ANTHROPIC_API_KEY in env.
//
// Flow:
//   1. Load prior state, sources, schema, sections.
//   2. Fetch each source URL.
//   3. Summarise each fetched page with Sonnet (structured signal extraction).
//   4. Synthesise the new seasonal-status.json with Sonnet.
//   5. Validate against the JSON schema + business rules.
//   6. Write public/seasonal-status.json and print a diff to stdout.
//
// Output is reviewed via `git diff` and committed on a branch by the maintainer.

import Anthropic from '@anthropic-ai/sdk';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SOURCES_PATH = path.resolve(PROJECT_ROOT, 'scripts/seasonal-status-sources.json');
const SCHEMA_PATH = path.resolve(PROJECT_ROOT, 'public/seasonal-status.schema.json');
const SECTIONS_PATH = path.resolve(PROJECT_ROOT, 'public/sections.json');
const OUTPUT_PATH = path.resolve(PROJECT_ROOT, 'public/seasonal-status.json');

const SYNTHESIS_MODEL = 'claude-sonnet-4-6';
const SUMMARY_MODEL = 'claude-sonnet-4-6';
const MAX_FETCH_BYTES = 500_000;
const MAX_SUMMARY_INPUT_CHARS = 30_000;
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = 'cldt-seasonal-status-updater/1.0 (+https://cldt.hr)';
const GPX_URL = process.env.NEXT_PUBLIC_GPX_URL;

// Known Croatian landmarks along the CLDT corridor. Their actual km position is
// resolved at run time by fetching the GPX and snapping each landmark to its
// nearest trail point. The resolved values are injected into the synthesis
// prompt so the model assigns correct distanceStartKm / distanceEndKm rather
// than guessing.
interface TrailLandmark {
	name: string;
	description: string;
	lat: number;
	lng: number;
}

const TRAIL_LANDMARKS: TrailLandmark[] = [
	{ name: 'Učka / Istria', description: 'Trail beginning, Učka peak (Vojak)', lat: 45.2952, lng: 14.2025 },
	{ name: 'Risnjak / Gorski kotar', description: 'Risnjak NP summit', lat: 45.4233, lng: 14.63 },
	{ name: 'Plitvička jezera', description: 'Plitvice Lakes NP', lat: 44.8689, lng: 15.6093 },
	{
		name: 'Zavižan / Sjeverni Velebit NP',
		description: 'Premužićeva staza start, DHMZ Zavižan met station',
		lat: 44.8128,
		lng: 14.9747,
	},
	{ name: 'Sjeverni Velebit ridge', description: 'Northern Velebit central ridge', lat: 44.7889, lng: 14.9628 },
	{ name: 'Paklenica / Starigrad', description: 'Paklenica NP entrance', lat: 44.305, lng: 15.4533 },
	{ name: 'Anića kuk', description: 'Paklenica climbing area, Put Malog Princa', lat: 44.3411, lng: 15.472 },
	{ name: 'Sveto brdo', description: 'Southern Velebit summit', lat: 44.2336, lng: 15.5614 },
	{ name: 'Dinara', description: 'Dinara peak (highest in Croatia)', lat: 44.0633, lng: 16.3833 },
	{ name: 'Krka NP', description: 'Skradinski buk waterfalls', lat: 43.8038, lng: 15.9656 },
	{ name: 'Biokovo / Sveti Jure', description: 'Biokovo NP peak', lat: 43.3367, lng: 17.0594 },
];

interface ResolvedLandmark extends TrailLandmark {
	trailKm: number;
	snapDistanceM: number;
}

interface TrailGeometry {
	totalKm: number;
	landmarks: ResolvedLandmark[];
}

// ---- Types -----------------------------------------------------------------
// Mirrors the shape exported from src/lib/seasonal-status.ts. The script runs
// outside the Next.js path graph, so the types are duplicated here. Keep both
// definitions in sync; the runtime check is the JSON schema in
// public/seasonal-status.schema.json.

type Severity = 'open' | 'caution' | 'closed_recommended' | 'experts_only';
type Season = 'winter' | 'shoulder' | 'summer' | 'year-round';

interface SeasonalStatusEntry {
	id: string;
	severity: Severity;
	season?: Season;
	distanceStartKm?: number;
	distanceEndKm?: number;
	sectionId?: string;
	validFrom: string;
	validUntil: string;
	note_en: string;
	note_hr: string;
	gear?: string;
	source: string;
	sourceUrl?: string;
	lastUpdated?: string;
}

interface SeasonalStatusFile {
	lastUpdated: string;
	source: string;
	sourceUrl?: string;
	entries: SeasonalStatusEntry[];
}

interface SourceEntry {
	name: string;
	url: string;
	language: 'hr' | 'en';
	covers: string;
	parseHint?: string;
}

interface FetchedSource {
	source: SourceEntry;
	text: string | null;
	error: string | null;
}

interface SourceSummary {
	source: SourceEntry;
	summary: string;
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
	if (!process.env.ANTHROPIC_API_KEY) {
		fail('ANTHROPIC_API_KEY is required in env.');
	}

	console.log('→ Loading project files...');
	const sources = await readJson<SourceEntry[]>(SOURCES_PATH);
	const schema = await readJson<object>(SCHEMA_PATH);
	const sections = await readJsonOptional<unknown>(SECTIONS_PATH);
	const prior = (await readJsonOptional<SeasonalStatusFile>(OUTPUT_PATH)) ?? emptyFile();
	console.log(`  ${sources.length} sources, ${prior.entries.length} prior entries.`);

	console.log('→ Resolving CLDT landmark positions from GPX...');
	const geometry = await resolveTrailGeometry();
	if (geometry) {
		console.log(`  Trail total: ${geometry.totalKm.toFixed(1)} km, ${geometry.landmarks.length} landmarks resolved.`);
	} else {
		console.log('  (skipped: GPX unreachable or NEXT_PUBLIC_GPX_URL unset)');
	}

	console.log('→ Fetching sources...');
	const fetched = await Promise.all(sources.map(fetchSource));
	for (const f of fetched) {
		console.log(`  ${f.error ? '✗' : '✓'} ${f.source.name}${f.error ? ` (${f.error})` : ''}`);
	}

	const client = new Anthropic();

	console.log('→ Summarising sources with Sonnet...');
	const summaries = await Promise.all(fetched.map((f) => summariseSource(client, f)));

	console.log('→ Synthesising new seasonal-status.json with Sonnet...');
	const next = await synthesise(client, { summaries, prior, sections, schema, geometry });
	normaliseDashes(next);

	console.log('→ Validating schema...');
	validateSchema(next, schema);

	console.log('→ Checking business rules...');
	checkBusinessRules(next, sections);

	console.log('→ Writing output...');
	await fs.writeFile(OUTPUT_PATH, JSON.stringify(next, null, '\t') + '\n', 'utf8');

	console.log('→ Diff:');
	printDiff(prior, next);

	console.log('\n✓ Done. Review with `git diff public/seasonal-status.json`, ' + 'commit on a branch, and open a PR.');
}

// ---- GPX landmark resolution ----------------------------------------------

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
	const R = 6_371_000;
	const toRad = (d: number): number => (d * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLng = toRad(b.lng - a.lng);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
}

async function resolveTrailGeometry(): Promise<TrailGeometry | null> {
	if (!GPX_URL) return null;
	try {
		const res = await fetch(GPX_URL);
		if (!res.ok) return null;
		const text = await res.text();

		interface LatLngKm {
			lat: number;
			lng: number;
			cumM: number;
		}
		const pts: LatLngKm[] = [];
		const re = /<trkpt\b[^>]*\blat="([\d.-]+)"[^>]*\blon="([\d.-]+)"/g;
		let m: RegExpExecArray | null;
		let cum = 0;
		let last: { lat: number; lng: number } | null = null;
		while ((m = re.exec(text)) !== null) {
			const lat = parseFloat(m[1]);
			const lng = parseFloat(m[2]);
			if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
			if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
			if (last) cum += haversineMeters(last, { lat, lng });
			pts.push({ lat, lng, cumM: cum });
			last = { lat, lng };
		}
		if (pts.length < 2) return null;

		const totalKm = pts[pts.length - 1].cumM / 1000;
		const landmarks: ResolvedLandmark[] = [];
		for (const lm of TRAIL_LANDMARKS) {
			let bestIdx = 0;
			let bestD = Infinity;
			for (let i = 0; i < pts.length; i++) {
				const d = haversineMeters(lm, pts[i]);
				if (d < bestD) {
					bestD = d;
					bestIdx = i;
				}
			}
			landmarks.push({
				...lm,
				trailKm: Math.round((pts[bestIdx].cumM / 1000) * 10) / 10,
				snapDistanceM: Math.round(bestD),
			});
		}
		return { totalKm, landmarks };
	} catch {
		return null;
	}
}

// ---- Fetching --------------------------------------------------------------

async function fetchSource(source: SourceEntry): Promise<FetchedSource> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(source.url, {
			headers: {
				'user-agent': USER_AGENT,
				accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
				'accept-language': 'hr,en;q=0.8',
			},
			signal: controller.signal,
		});
		if (!res.ok) return { source, text: null, error: `HTTP ${res.status}` };

		// Read at most MAX_FETCH_BYTES so a huge page doesn't blow up the run.
		const reader = res.body?.getReader();
		if (!reader) return { source, text: null, error: 'no response body' };
		const chunks: Uint8Array[] = [];
		let total = 0;
		while (total < MAX_FETCH_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			total += value.byteLength;
		}
		const buf = Buffer.concat(chunks);
		const html = buf.toString('utf8');
		return { source, text: extractText(html), error: null };
	} catch (err) {
		return { source, text: null, error: (err as Error).message };
	} finally {
		clearTimeout(timeout);
	}
}

function extractText(html: string): string {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
		.replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
		.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\b[^>]*>/gi, ' ')
		.replace(/<!--[\s\S]*?--\s*!?>/g, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
}

// ---- Summarisation (Sonnet) ------------------------------------------------

async function summariseSource(client: Anthropic, fetched: FetchedSource): Promise<SourceSummary> {
	if (fetched.error || !fetched.text) {
		return {
			source: fetched.source,
			summary: `[unreachable: ${fetched.error ?? 'no content'}]`,
		};
	}

	const content = fetched.text.slice(0, MAX_SUMMARY_INPUT_CHARS);
	const parseHint = fetched.source.parseHint
		? `\n\nParsing guidance for this source:\n${fetched.source.parseHint}`
		: '';

	const prompt =
		`You are extracting Croatian-trail-status signals from a source page.\n\n` +
		`Source: ${fetched.source.name}\n` +
		`URL: ${fetched.source.url}\n` +
		`Page covers: ${fetched.source.covers}` +
		`${parseHint}\n\n` +
		`Page content (Croatian or English):\n${content}\n\n` +
		`Extract every concrete signal about current or forthcoming trail / mountain ` +
		`conditions relevant to the Croatia Long Distance Trail (CLDT) or to Croatian ` +
		`mountain ranges (Velebit, Biokovo, Risnjak, Učka, Gorski kotar, Plitvice, ` +
		`Paklenica, Krka). For each signal, give:\n` +
		`  - region or section name, and approximate distance range along CLDT if you can infer it\n` +
		`  - condition (snow depth, avalanche risk, bura wind, closure, hut closure, etc.)\n` +
		`  - severity guess (caution / closed_recommended / experts_only)\n` +
		`  - valid window if mentioned\n` +
		`  - a direct quoted phrase as evidence\n\n` +
		`If nothing relevant is on the page, reply exactly: NO SIGNALS.\n` +
		`Do NOT invent details. Only report what is explicitly on the page.`;

	const response = await client.messages.create({
		model: SUMMARY_MODEL,
		max_tokens: 1500,
		messages: [{ role: 'user', content: prompt }],
	});

	const text = response.content
		.filter((b): b is Anthropic.TextBlock => b.type === 'text')
		.map((b) => b.text)
		.join('\n')
		.trim();

	return { source: fetched.source, summary: text };
}

// ---- Synthesis (Sonnet) ----------------------------------------------------

async function synthesise(
	client: Anthropic,
	args: {
		summaries: SourceSummary[];
		prior: SeasonalStatusFile;
		sections: unknown;
		schema: object;
		geometry: TrailGeometry | null;
	},
): Promise<SeasonalStatusFile> {
	const today = isoDate(new Date());
	const system = buildSynthesisSystem({
		today,
		schema: args.schema,
		sections: args.sections,
		geometry: args.geometry,
	});
	const user = buildSynthesisUser({ summaries: args.summaries, prior: args.prior });

	const response = await client.messages.create({
		model: SYNTHESIS_MODEL,
		max_tokens: 16_000,
		system,
		messages: [{ role: 'user', content: user }],
	});

	const raw = response.content
		.filter((b): b is Anthropic.TextBlock => b.type === 'text')
		.map((b) => b.text)
		.join('\n');
	return parseJsonObject<SeasonalStatusFile>(raw);
}

function buildSynthesisSystem(args: {
	today: string;
	schema: object;
	sections: unknown;
	geometry: TrailGeometry | null;
}): string {
	const geometryBlock = args.geometry
		? [
				`TRAIL GEOMETRY:`,
				`Total CLDT length: ${args.geometry.totalKm.toFixed(1)} km.`,
				``,
				`LANDMARK KM POSITIONS (use these when assigning distanceStartKm / distanceEndKm; ` +
					`these are the actual cumulative km along the CLDT polyline, snapped to the GPX):`,
				...args.geometry.landmarks.map((lm) => `  - ${lm.name} (${lm.description}): km ${lm.trailKm.toFixed(1)}`),
				``,
				`When a source mentions a region, set distanceStartKm / distanceEndKm to bracket the ` +
					`relevant landmark km values. Examples:`,
				`  - "Velebit ridge" → span Zavižan through Sveto brdo`,
				`  - "Paklenica" → span Paklenica / Starigrad through Anića kuk (a few km of padding ok)`,
				`  - "Gospićka regija" (DHMZ) → covers the full Velebit range`,
				`  - "Velebitski kanal" (DHMZ) → western face of Velebit, same km range as the ridge`,
				`  - "Sjeverna Dalmacija" (DHMZ) → southern Velebit through Krka`,
				`  - "Riječka regija" (DHMZ) → Risnjak / Gorski kotar area`,
				`Do NOT invent km values. If you cannot map a region to a landmark, use the nearest ` +
					`landmark range and add a few km of padding on either side.`,
				``,
			].join('\n')
		: [
				`TRAIL GEOMETRY:`,
				`(GPX unreachable this run. Avoid creating new entries with distanceStartKm / ` +
					`distanceEndKm; only EXTEND existing entries whose km values were already set.)`,
				``,
			].join('\n');

	return [
		`You curate seasonal trail-status entries for the Croatia Long Distance Trail (CLDT).`,
		``,
		`Today's date: ${args.today}`,
		``,
		`OUTPUT: exactly one JSON object matching the schema below. No prose, no Markdown ` +
			`fences, no explanation. Start with { and end with }.`,
		``,
		`SCHEMA:`,
		JSON.stringify(args.schema, null, 2),
		``,
		`SECTION TAXONOMY (sectionId references must resolve to one of these ids):`,
		JSON.stringify(args.sections ?? {}, null, 2),
		``,
		geometryBlock,
		`UPDATE RULES:`,
		`1. ADD a new entry when a source summary reports a hazard not represented by an ` +
			`existing active entry. Required fields: id, severity, validFrom, validUntil, ` +
			`note_en, note_hr, source. Use id format "{region}-{hazard}-{year}" e.g. ` +
			`"velebit-ridge-winter-2026". sourceUrl is required for new entries.`,
		`2. EXTEND an existing entry when a source confirms its conditions are ongoing - ` +
			`bump validUntil forward by at most 14 days. Update lastUpdated to today.`,
		`3. RAISE severity if a source reports worsening conditions; LOWER severity only if ` +
			`a source explicitly reports improvement.`,
		`4. EXPIRE an entry (drop it from the output) when validUntil has passed OR a source ` +
			`explicitly reports the hazard has lifted.`,
		`5. LEAVE an entry alone if no source mentions it AND validUntil has not passed.`,
		`6. NEVER invent entries. Every new or modified entry MUST cite sourceUrl pointing ` +
			`to one of the URLs that appeared in the source summaries below.`,
		`7. When uncertain, prefer "caution" over "closed_recommended"; prefer keeping a ` +
			`prior entry over rewriting it.`,
		`8. note_hr should preserve the source's Croatian phrasing; note_en is your faithful ` +
			`English summary of note_hr.`,
		`9. Each entry must reference its trail segment by EITHER distanceStartKm + ` +
			`distanceEndKm (using the landmark km positions above) OR sectionId (which must ` +
			`match the taxonomy above). Prefer distance ranges.`,
		`10. Set the top-level lastUpdated to today's date.`,
		`11. When the prior entries have km values that conflict with the landmark positions ` +
			`above (e.g. a Paklenica entry with km 400 when Paklenica is actually at km 600), ` +
			`treat that as wrong data and rewrite the entry with correct km values, keeping the ` +
			`same id and other metadata.`,
	].join('\n');
}

function buildSynthesisUser(args: { summaries: SourceSummary[]; prior: SeasonalStatusFile }): string {
	const summariesBlock = args.summaries
		.map(
			(s) => `### ${s.source.name}\n` + `URL: ${s.source.url}\n` + `Covers: ${s.source.covers}\n\n` + `${s.summary}\n`,
		)
		.join('\n---\n\n');

	return [
		`SOURCE SUMMARIES:`,
		``,
		summariesBlock,
		``,
		`PRIOR STATE (the current seasonal-status.json):`,
		JSON.stringify(args.prior, null, 2),
		``,
		`Produce the updated seasonal-status.json now. Output JSON only.`,
	].join('\n');
}

// ---- Dash normalisation ----------------------------------------------------
// Replaces em-dash (U+2014), en-dash (U+2013), and minus-sign (U+2212) with a
// hyphen-minus in every string field.

function normaliseDashes(file: SeasonalStatusFile): void {
	const clean = (s: string): string => s.replace(/[\u2014\u2013\u2212]/g, '-');
	file.lastUpdated = clean(file.lastUpdated);
	file.source = clean(file.source);
	if (file.sourceUrl) file.sourceUrl = clean(file.sourceUrl);
	for (const e of file.entries) {
		e.id = clean(e.id);
		e.note_en = clean(e.note_en);
		e.note_hr = clean(e.note_hr);
		e.source = clean(e.source);
		if (e.sourceUrl) e.sourceUrl = clean(e.sourceUrl);
		if (e.gear) e.gear = clean(e.gear);
		if (e.lastUpdated) e.lastUpdated = clean(e.lastUpdated);
		if (e.sectionId) e.sectionId = clean(e.sectionId);
	}
}

// ---- Validation ------------------------------------------------------------

function validateSchema(file: SeasonalStatusFile, schema: object): void {
	const ajv = new Ajv({ strict: false, allErrors: true });
	addFormats(ajv);
	const validate = ajv.compile(schema);
	if (!validate(file)) {
		console.error('✗ Schema validation failed:');
		for (const err of validate.errors ?? []) {
			console.error(`  ${err.instancePath} ${err.message}`);
		}
		process.exit(1);
	}
}

function checkBusinessRules(file: SeasonalStatusFile, sections: unknown): void {
	const errors: string[] = [];
	const today = isoDate(new Date());

	const sectionIds = new Set<string>();
	if (sections && typeof sections === 'object' && 'sections' in sections) {
		const arr = (sections as { sections?: Array<{ id?: string }> }).sections ?? [];
		for (const s of arr) if (s?.id) sectionIds.add(s.id);
	}

	for (const entry of file.entries) {
		if (entry.validFrom > entry.validUntil) {
			errors.push(`${entry.id}: validFrom > validUntil`);
		}
		if (entry.validUntil < today) {
			errors.push(`${entry.id}: validUntil is in the past - should have been expired`);
		}
		if (entry.sectionId && sectionIds.size > 0 && !sectionIds.has(entry.sectionId)) {
			errors.push(`${entry.id}: sectionId "${entry.sectionId}" not in taxonomy`);
		}
		if (
			typeof entry.distanceStartKm === 'number' &&
			typeof entry.distanceEndKm === 'number' &&
			entry.distanceStartKm >= entry.distanceEndKm
		) {
			errors.push(`${entry.id}: distanceStartKm >= distanceEndKm`);
		}
		if (!entry.sectionId && typeof entry.distanceStartKm !== 'number') {
			errors.push(`${entry.id}: must specify either sectionId or distance range`);
		}
	}

	if (errors.length) {
		console.error('✗ Business rule failures:');
		for (const e of errors) console.error(`  ${e}`);
		process.exit(1);
	}
}

// ---- Diff output -----------------------------------------------------------

function printDiff(prior: SeasonalStatusFile, next: SeasonalStatusFile): void {
	const priorById = new Map(prior.entries.map((e) => [e.id, e]));
	const nextById = new Map(next.entries.map((e) => [e.id, e]));

	const added = next.entries.filter((e) => !priorById.has(e.id));
	const removed = prior.entries.filter((e) => !nextById.has(e.id));
	const modified = next.entries.filter((e) => {
		const old = priorById.get(e.id);
		return old && JSON.stringify(old) !== JSON.stringify(e);
	});

	for (const e of added) {
		console.log(`  + ${e.id}  (${e.severity}, ${e.validFrom} → ${e.validUntil})`);
	}
	for (const e of removed) {
		console.log(`  - ${e.id}`);
	}
	for (const e of modified) {
		console.log(`  ~ ${e.id}  (${e.severity}, ${e.validFrom} → ${e.validUntil})`);
	}
	if (!added.length && !removed.length && !modified.length) {
		console.log('  (no changes)');
	}
}

// ---- Helpers ---------------------------------------------------------------

async function readJson<T>(p: string): Promise<T> {
	return JSON.parse(await fs.readFile(p, 'utf8')) as T;
}

async function readJsonOptional<T>(p: string): Promise<T | null> {
	try {
		return await readJson<T>(p);
	} catch {
		return null;
	}
}

function emptyFile(): SeasonalStatusFile {
	return {
		lastUpdated: isoDate(new Date()),
		source: 'LDTH',
		sourceUrl: 'https://cldt.hr',
		entries: [],
	};
}

function isoDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function parseJsonObject<T>(raw: string): T {
	const cleaned = raw
		.replace(/^```(?:json)?\s*/m, '')
		.replace(/```\s*$/m, '')
		.trim();
	const start = cleaned.indexOf('{');
	const end = cleaned.lastIndexOf('}');
	if (start === -1 || end === -1 || end <= start) {
		throw new Error('No JSON object in model response.');
	}
	return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

function fail(msg: string): never {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

main().catch((err) => {
	console.error('✗ Update failed:', err);
	process.exit(1);
});
