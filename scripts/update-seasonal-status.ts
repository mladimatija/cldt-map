// Curates public/seasonal-status.json from live Croatian trail-status sources.
//
// Run: `npm run update-seasonal`
// Requires: ANTHROPIC_API_KEY in env.
//
// Hard-grounded flow (every claim must trace back to a verifiable quote):
//   1. Load prior state, sources, schema, sections.
//   2. Fetch each source URL; keep the normalized page text.
//   3. Summarize each fetched page with Sonnet -> STRUCTURED signals, each with
//      a verbatim `quote` from the page.
//   4. Programmatically verify each quote is a literal substring of the source
//      text. Drop any signal whose quote cannot be found.
//   5. Synthesize the new seasonal-status.json with Sonnet (prompt-cached
//      system prompt). Every entry must carry an `evidence` field naming the
//      source and quoting the supporting text.
//   6. Programmatically verify each entry's evidence: source name matches a
//      fetched source, quote matches one of the verified signals from that
//      source, sourceUrl is in the allowlist. Drop entries that fail.
//   7. Opus critic pass (prompt-cached rubric) reviews every entry against the
//      verified signals. Strip entries the critic flags as unsupported. If
//      more than half the entries fail, abort the run.
//   8. Strip the audit-only `evidence` field, normalise dashes, validate
//      schema + business rules.
//   9. Write public/seasonal-status.json and print a diff to stdout.
//
// Output is reviewed via `git diff` and committed to a branch by the maintainer.

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
const CRITIC_MODEL = 'claude-opus-4-7';
const MAX_FETCH_BYTES = 500_000;
const MAX_SUMMARY_INPUT_CHARS = 30_000;
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = 'cldt-seasonal-status-updater/1.0 (+https://cldt.hr)';
const GPX_URL = process.env.NEXT_PUBLIC_GPX_URL;

/** Fraction of entries the Opus critic must approve. Below this the run aborts
 *  rather than ship a low-confidence file. 0.5 is permissive on purpose: most
 *  weeks the critic agrees on >=80%, and the alarm should fire only on a real
 *  systemic regression (e.g., a source went down and the model hallucinated). */
const MIN_CRITIC_APPROVAL_RATIO = 0.5;

// Known Croatian landmarks along the CLDT corridor. Their actual km position is
// resolved at run time by fetching the GPX and snapping each landmark to its
// nearest trail point. The resolved values are injected into the synthesis
//  prompt, so the model assigns the correct distanceStartKm / distanceEndKm rather
// than guessing.
interface TrailLandmark {
	name: string;
	description: string;
	lat: number;
	lng: number;
}

// 36-landmark spine of the CLDT, validated against the v1 GPX in 2026 (every
// coordinate snaps to within ~6 km of the actual trail line; most are <1 km).
// Coverage is roughly every 50-100 km along 2,220 km of trail, organized
// roughly NOBO-to-SOBO.
const TRAIL_LANDMARKS: TrailLandmark[] = [
	// Eastern Slavonia (km 0-150)
	{ name: 'Ilok', description: 'Trail terminus, Danube confluence, easternmost CLDT point', lat: 45.227, lng: 19.376 },
	{ name: 'Vukovar', description: 'Eastern Slavonia, Vukovar / Vučedol', lat: 45.355, lng: 18.996 },
	{ name: 'Osijek', description: 'Osijek, Drava-Slavonia plain', lat: 45.555, lng: 18.6955 },
	{ name: 'Kopački rit', description: 'Kopački rit Nature Park, Baranja wetlands', lat: 45.602, lng: 18.766 },
	// Slavonian highlands (km 240-290)
	{ name: 'Našice / Krndija foot', description: 'Approach to Krndija / Papuk via Našice', lat: 45.4925, lng: 18.09 },
	{ name: 'Krndija', description: 'Krndija range, eastern Slavonian highlands', lat: 45.45, lng: 17.9 },
	{ name: 'Papuk NP', description: 'Papuk Nature Park, central Slavonian massif', lat: 45.5083, lng: 17.6833 },
	// Continental Croatia (km 420-580)
	{ name: 'Bilogora', description: 'Bilogora range, northern continental Croatia', lat: 45.9583, lng: 16.9417 },
	{ name: 'Kalnik', description: 'Kalnik mountain, north of Križevci', lat: 46.15, lng: 16.45 },
	{
		name: 'Međimurje (Mura/Drava)',
		description: 'Mura-Drava confluence, northernmost CLDT extent',
		lat: 46.48,
		lng: 16.45,
	},
	// Hrvatsko zagorje + Slovenian-border ranges (km 685-745)
	{ name: 'Macelj', description: 'Macelj range, Slovenian border', lat: 46.25, lng: 15.85 },
	{ name: 'Strahinjčica', description: 'Strahinjčica, Hrvatsko zagorje', lat: 46.1858, lng: 15.9333 },
	{ name: 'Ivanščica', description: 'Ivanščica, highest peak in Hrvatsko zagorje', lat: 46.1844, lng: 16.1517 },
	// Zagreb belt + Žumberak (km 790-880)
	{
		name: 'Medvednica (Sljeme)',
		description: 'Medvednica Nature Park above Zagreb, Sljeme peak',
		lat: 45.8989,
		lng: 15.9667,
	},
	{ name: 'Samoborsko gorje', description: 'Samobor highlands west of Zagreb', lat: 45.7833, lng: 15.65 },
	{ name: 'Žumberak / Sveta gera', description: 'Žumberak Nature Park, Sveta gera peak', lat: 45.7547, lng: 15.3247 },
	// Gorski kotar (km 1070-1080)
	{
		name: 'Risnjak NP',
		description: 'Risnjak National Park; trail passes the NP, not the summit itself',
		lat: 45.4283,
		lng: 14.6181,
	},
	{ name: 'Snježnik', description: 'Snježnik peak, western Gorski kotar', lat: 45.4393, lng: 14.5532 },
	// Istria (km 1410-1420)
	{ name: 'Učka (Vojak)', description: 'Učka mountain Vojak summit, highest in Istria', lat: 45.2939, lng: 14.2023 },
	{ name: 'Poklon pass (Učka)', description: 'Poklon pass on Učka, mountain hut', lat: 45.3322, lng: 14.2222 },
	// Velika Kapela (km 1510)
	{
		name: 'Bjelolasica / Velika Kapela',
		description: 'Bjelolasica massif, Velika Kapela range, central Gorski kotar',
		lat: 45.2828,
		lng: 14.9586,
	},
	// Northern Velebit (km 1578-1600)
	{
		name: 'Zavižan / Sjeverni Velebit NP',
		description: 'Premužićeva staza start, DHMZ Zavižan met station',
		lat: 44.8128,
		lng: 14.9747,
	},
	{
		name: 'Sjeverni Velebit ridge',
		description: 'Northern Velebit central ridge, Premužićeva staza',
		lat: 44.7889,
		lng: 14.9628,
	},
	{
		name: 'Veliki Alan',
		description: 'Veliki Alan saddle and mountain hut, central Velebit',
		lat: 44.6917,
		lng: 15.0244,
	},
	// Southern Velebit / Paklenica (km 1665-1695)
	{
		name: 'Paklenica entrance (Starigrad)',
		description: 'NP Paklenica entrance; trail passes inland of the canyon mouth',
		lat: 44.305,
		lng: 15.4533,
	},
	{ name: 'Anića kuk', description: 'Paklenica climbing area, Put Malog Princa trail', lat: 44.3411, lng: 15.472 },
	{
		name: 'Vaganski vrh',
		description: 'Vaganski vrh, highest peak in Velebit (adjacent to ridge trail)',
		lat: 44.4097,
		lng: 15.5158,
	},
	{
		name: 'Sveto brdo',
		description: 'Sveto brdo, southern Velebit summit (adjacent to ridge trail)',
		lat: 44.2336,
		lng: 15.5614,
	},
	{ name: 'Tulove grede', description: 'Tulove grede rocky towers, southern Velebit', lat: 44.275, lng: 15.65 },
	// Inland Dalmatia (km 1800-1840)
	{
		name: 'Dinara (Sinjal)',
		description: 'Dinara range, Sinjal peak (highest in Croatia, 1831 m)',
		lat: 44.0631,
		lng: 16.3839,
	},
	{ name: 'Troglav', description: 'Troglav peak, Dinaric range, Croatian-Bosnian border', lat: 43.9683, lng: 16.6017 },
	// Central Dalmatia (km 1920-1960)
	{ name: 'Omiš / Cetina', description: 'Omiš coast, Cetina river canyon', lat: 43.45, lng: 16.69 },
	{ name: 'Biokovo / Sveti Jure', description: 'Biokovo Nature Park, Sveti Jure peak', lat: 43.3367, lng: 17.0594 },
	// South Dalmatia (km 2050-2220)
	{ name: 'Pelješac (Sv. Ilija)', description: 'Pelješac peninsula, Sv. Ilija peak', lat: 42.9583, lng: 17.3 },
	{ name: 'Dubrovnik area', description: 'Dubrovnik / southern coast approach', lat: 42.65, lng: 18.09 },
	{ name: 'Konavoska brda', description: 'Konavle highlands, southern Croatia', lat: 42.5, lng: 18.4 },
	{
		name: 'Trail end (Prevlaka / Konavle)',
		description: 'Trail terminus at Prevlaka peninsula, Croatian-Montenegrin border',
		lat: 42.393,
		lng: 18.533,
	},
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

/** Audit-only field the synthesizer must produce per entry. Stripped before
 *  the file is written so the on-disk schema stays clean. */
interface EvidenceRef {
	source_name: string;
	quote: string;
}

interface SeasonalStatusEntryWithEvidence extends SeasonalStatusEntry {
	evidence?: EvidenceRef;
}

interface SeasonalStatusFile {
	lastUpdated: string;
	source: string;
	sourceUrl?: string;
	entries: SeasonalStatusEntry[];
}

interface SeasonalStatusDraft {
	lastUpdated: string;
	source: string;
	sourceUrl?: string;
	entries: SeasonalStatusEntryWithEvidence[];
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

/** Raw structured signal as returned by the summarizer model. */
interface RawSignal {
	region?: string;
	hazard?: string;
	severity_guess?: Severity | 'unknown';
	valid_window?: string;
	quote: string;
}

/** A signal whose quote has been verified to occur literally in the source
 *  text. Only verified signals are passed to the synthesizer. */
interface VerifiedSignal {
	source_name: string;
	source_url: string;
	region: string;
	hazard: string;
	severity_guess: Severity | 'unknown';
	valid_window: string;
	quote: string;
}

interface SourceSummary {
	source: SourceEntry;
	signals: RawSignal[];
	error: string | null;
}

interface CriticVerdict {
	id: string;
	supported: boolean;
	reason: string;
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

	console.log('→ Summarising sources with Sonnet (structured signals)...');
	const summaries = await Promise.all(fetched.map((f) => summariseSource(client, f)));

	console.log('→ Verifying signal quotes against source text...');
	const verifiedSignals = verifySignalQuotes(fetched, summaries);
	console.log(
		`  ${verifiedSignals.length} verified signals across ${summaries.filter((s) => s.signals.length > 0).length} sources.`,
	);
	if (verifiedSignals.length === 0) {
		console.warn('  ⚠ No verified signals this run; output will drop every prior entry without corroboration.');
	}

	console.log('→ Synthesising candidate seasonal-status.json with Sonnet...');
	const allowedSourceUrls = new Set(fetched.map((f) => f.source.url));
	const draft = await synthesise(client, {
		signals: verifiedSignals,
		prior,
		sections,
		schema,
		geometry,
	});

	console.log('→ Verifying entry evidence...');
	const evidenceVerified = verifyEvidence(draft, verifiedSignals, allowedSourceUrls);

	console.log('→ Opus critic pass...');
	const criticApproved = await runCritic(client, evidenceVerified, verifiedSignals);

	const next = stripEvidence(criticApproved);
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

// ---- Summarisation (Sonnet, structured) ------------------------------------

async function summariseSource(client: Anthropic, fetched: FetchedSource): Promise<SourceSummary> {
	if (fetched.error || !fetched.text) {
		return { source: fetched.source, signals: [], error: fetched.error ?? 'no content' };
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
		`Paklenica, Krka).\n\n` +
		`Reply with ONE JSON object: { "signals": [...] }. Each signal must have:\n` +
		`  - "region": region or mountain name (string)\n` +
		`  - "hazard": short description of the condition (string)\n` +
		`  - "severity_guess": one of "caution", "closed_recommended", "experts_only", or "unknown"\n` +
		`  - "valid_window": validity window if mentioned, otherwise "" (string)\n` +
		`  - "quote": a VERBATIM substring of the page content above, between 10 and 280 characters,\n` +
		`    that directly supports the signal. The quote MUST appear character-for-character\n` +
		`    in the page text - do not paraphrase, translate, summarise, or merge fragments.\n\n` +
		`If the page has no relevant signals, reply exactly: { "signals": [] }\n\n` +
		`Output JSON only - no prose, no Markdown fences, no explanation. Start with { and end with }.\n` +
		`Do NOT invent details. Only report what is explicitly on the page.`;

	const response = await client.messages.create({
		model: SUMMARY_MODEL,
		max_tokens: 2000,
		messages: [{ role: 'user', content: prompt }],
	});

	const text = response.content
		.filter((b): b is Anthropic.TextBlock => b.type === 'text')
		.map((b) => b.text)
		.join('\n')
		.trim();

	try {
		const parsed = parseJsonObject<{ signals?: RawSignal[] }>(text);
		const signals = Array.isArray(parsed.signals) ? parsed.signals : [];
		return { source: fetched.source, signals, error: null };
	} catch (err) {
		return { source: fetched.source, signals: [], error: `summary-parse: ${(err as Error).message}` };
	}
}

// ---- Quote verification ----------------------------------------------------

/** Normalize whitespace and case for substring matching against the
 *  extractText() output. extractText collapses all whitespace to single
 *  spaces, so quotes need the same treatment to match reliably. */
function normaliseForMatch(s: string): string {
	return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function verifySignalQuotes(fetched: FetchedSource[], summaries: SourceSummary[]): VerifiedSignal[] {
	const verified: VerifiedSignal[] = [];
	const sourceTextByName = new Map<string, string>();
	for (const f of fetched) {
		if (f.text) sourceTextByName.set(f.source.name, normaliseForMatch(f.text));
	}

	for (const summary of summaries) {
		if (summary.error) continue;
		const haystack = sourceTextByName.get(summary.source.name);
		if (!haystack) continue;
		for (const sig of summary.signals) {
			if (typeof sig.quote !== 'string' || sig.quote.length < 10) continue;
			const needle = normaliseForMatch(sig.quote);
			if (!haystack.includes(needle)) {
				console.warn(
					`  ⚠ Dropping unverified signal from ${summary.source.name}: ` +
						`quote not found in source. Quote: "${sig.quote.slice(0, 80)}..."`,
				);
				continue;
			}
			verified.push({
				source_name: summary.source.name,
				source_url: summary.source.url,
				region: typeof sig.region === 'string' ? sig.region : '',
				hazard: typeof sig.hazard === 'string' ? sig.hazard : '',
				severity_guess: sig.severity_guess ?? 'unknown',
				valid_window: typeof sig.valid_window === 'string' ? sig.valid_window : '',
				quote: sig.quote.trim(),
			});
		}
	}
	return verified;
}

// ---- Synthesis (Sonnet, prompt-cached) -------------------------------------

async function synthesise(
	client: Anthropic,
	args: {
		signals: VerifiedSignal[];
		prior: SeasonalStatusFile;
		sections: unknown;
		schema: object;
		geometry: TrailGeometry | null;
	},
): Promise<SeasonalStatusDraft> {
	const today = isoDate(new Date());
	const system = buildSynthesisSystem({
		today,
		schema: args.schema,
		sections: args.sections,
		geometry: args.geometry,
	});
	const user = buildSynthesisUser({ signals: args.signals, prior: args.prior });

	const response = await client.messages.create({
		model: SYNTHESIS_MODEL,
		max_tokens: 16_000,
		system: [
			{
				type: 'text',
				text: system,
				cache_control: { type: 'ephemeral' },
			},
		],
		messages: [{ role: 'user', content: user }],
	});

	logCacheUsage('synthesis', response.usage);

	const raw = response.content
		.filter((b): b is Anthropic.TextBlock => b.type === 'text')
		.map((b) => b.text)
		.join('\n');
	return parseJsonObject<SeasonalStatusDraft>(raw);
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
					`relevant landmark km values. Examples (Velebit / coastal):`,
				`  - "Velebit ridge" -> span Zavižan through Sveto brdo`,
				`  - "Paklenica" -> span Paklenica entrance through Anića kuk (a few km of padding ok)`,
				`  - "Gospićka regija" (DHMZ) -> covers the full Velebit range`,
				`  - "Velebitski kanal" (DHMZ) -> western face of Velebit, same km range as the ridge`,
				`  - "Sjeverna Dalmacija" (DHMZ) -> southern Velebit through Dinara / Tulove grede`,
				`  - "Riječka regija" (DHMZ) -> Risnjak / Gorski kotar area`,
				`Examples (continental / Slavonia, where the trail spends km 0-1000):`,
				`  - "Osječka regija" (DHMZ) -> Slavonian plain: Ilok through Osijek / Kopački rit`,
				`  - "Sjeverna Hrvatska" / "Bjelovarska regija" -> Bilogora / Kalnik corridor`,
				`  - "Međimurska / Varaždinska regija" -> Međimurje through Macelj / Ivanščica`,
				`  - "Zagrebačka regija" -> Medvednica / Samoborsko gorje / Žumberak corridor`,
				`  - "Karlovačka regija" -> Žumberak south and approach to Gorski kotar`,
				`  - "Splitsko-dalmatinska regija" -> Dinara / Omiš / Biokovo`,
				`  - "Dubrovačko-neretvanska regija" -> Pelješac / Dubrovnik approach / Konavle`,
				`Do NOT invent km values. If you cannot map a region to a landmark, use the nearest ` +
					`landmark range and add a few km of padding on either side.`,
				``,
			].join('\n')
		: [
				`TRAIL GEOMETRY:`,
				`(GPX unreachable this run. Avoid creating new entries with distanceStartKm / ` +
					`distanceEndKm; only re-emit existing entries whose km values were already set.)`,
				``,
			].join('\n');

	return [
		`You curate seasonal trail-status entries for the Croatia Long Distance Trail (CLDT).`,
		``,
		`Today's date: ${args.today}`,
		``,
		`OUTPUT: exactly one JSON object matching the schema below, plus an "evidence" field on each ` +
			`entry. No prose, no Markdown fences, no explanation. Start with { and end with }.`,
		``,
		`SCHEMA:`,
		JSON.stringify(args.schema, null, 2),
		``,
		`EVIDENCE (per-entry audit field, REQUIRED on every entry you emit):`,
		`Each entry MUST include an "evidence" object with these fields:`,
		`  - "source_name": the exact name of the source from the VERIFIED SIGNALS block below.`,
		`  - "quote": one of the verbatim quotes from that source in the VERIFIED SIGNALS block.`,
		`If you cannot point to a verified signal that supports the entry, do NOT emit the entry.`,
		`The "evidence" field is audit metadata; the script strips it before writing to disk.`,
		``,
		`SECTION TAXONOMY (sectionId references must resolve to one of these ids):`,
		JSON.stringify(args.sections ?? {}, null, 2),
		``,
		geometryBlock,
		`HARD GROUNDING RULES:`,
		`1. Every entry you emit must trace back to at least one verified signal. If no signal ` +
			`mentions a region, hazard, or timing, the entry cannot exist.`,
		`1a. OFF-ROUTE GUARD: the landmark list above is the complete spine of the CLDT. If a ` +
			`source describes conditions in a region that is NOT in the landmark list (for example: ` +
			`Plitvička jezera, Krka NP, Mljet, Brač/Hvar, Vrgorac, or any other area not named ` +
			`above), the trail does NOT pass through that region. Do NOT create an entry for it - ` +
			`even if the source is in the configured sources list. Drop the signal silently.`,
		`2. Do NOT re-emit a prior entry just because it appears in the PRIOR STATE block. The ` +
			`prior state is shown only so you can reserve stable ids and stable fields ` +
			`(validFrom, severity) when a current signal corroborates the same hazard. If no ` +
			`current signal corroborates a prior entry, drop it.`,
		`3. NEVER paraphrase or extrapolate beyond what the signals state. If a signal says ` +
			`"closure recommended", do not promote it to "experts only". If a signal omits a ` +
			`date, use a conservative 14-day window from today's date.`,
		`4. sourceUrl on every entry must match the source_url of the VERIFIED SIGNAL you cite.`,
		``,
		`UPDATE RULES:`,
		`A. ADD a new entry when a verified signal reports a hazard not represented by a prior ` +
			`entry. Required fields: id, severity, validFrom, validUntil, note_en, note_hr, ` +
			`source, sourceUrl. Use id format "{region}-{hazard}-{year}" e.g. ` +
			`"velebit-ridge-winter-2026".`,
		`B. EXTEND a prior entry when a current signal confirms its conditions are ongoing - ` +
			`reuse the same id and stable fields, bump validUntil forward by at most 14 days, ` +
			`update lastUpdated to today.`,
		`C. RAISE severity if a current signal explicitly reports worsening conditions; LOWER ` +
			`severity only if a current signal explicitly reports improvement.`,
		`D. When uncertain, prefer "caution" over "closed_recommended"; prefer copying the ` +
			`signal's "severity_guess" verbatim.`,
		`E. note_hr should preserve the source's Croatian phrasing as closely as the quote ` +
			`allows; note_en is your faithful English translation of note_hr - no embellishment.`,
		`F. Each entry must reference its trail segment by EITHER distanceStartKm + ` +
			`distanceEndKm (using the landmark km positions above) OR sectionId (which must ` +
			`match the taxonomy above). Prefer distance ranges.`,
		`G. Set the top-level lastUpdated to today's date.`,
		`H. When prior entries have km values that conflict with the landmark positions above ` +
			`(e.g. a Paklenica entry with km 400 when Paklenica is actually at km 600), treat that ` +
			`as wrong data and rewrite the entry with correct km values, keeping the same id.`,
	].join('\n');
}

function buildSynthesisUser(args: { signals: VerifiedSignal[]; prior: SeasonalStatusFile }): string {
	const signalsBlock =
		args.signals.length === 0
			? `(no verified signals this run)`
			: args.signals
					.map(
						(s, i) =>
							`Signal ${i + 1}\n` +
							`  source_name: ${s.source_name}\n` +
							`  source_url: ${s.source_url}\n` +
							`  region: ${s.region}\n` +
							`  hazard: ${s.hazard}\n` +
							`  severity_guess: ${s.severity_guess}\n` +
							`  valid_window: ${s.valid_window || '(unspecified)'}\n` +
							`  quote: ${JSON.stringify(s.quote)}`,
					)
					.join('\n\n');

	return [
		`VERIFIED SIGNALS (every entry you emit must trace to at least one of these):`,
		``,
		signalsBlock,
		``,
		`PRIOR STATE (id reservation hint only - do not re-emit entries that no signal supports):`,
		JSON.stringify(args.prior, null, 2),
		``,
		`Produce the updated seasonal-status.json now. Each entry must include an "evidence" ` +
			`object with "source_name" and "quote" from one of the verified signals above. ` +
			`Output JSON only.`,
	].join('\n');
}

// ---- Evidence verification (programmatic) ----------------------------------

function verifyEvidence(
	draft: SeasonalStatusDraft,
	signals: VerifiedSignal[],
	allowedSourceUrls: Set<string>,
): SeasonalStatusDraft {
	const signalsByName = new Map<string, VerifiedSignal[]>();
	for (const s of signals) {
		const list = signalsByName.get(s.source_name) ?? [];
		list.push(s);
		signalsByName.set(s.source_name, list);
	}

	const kept: SeasonalStatusEntryWithEvidence[] = [];
	let dropped = 0;
	for (const entry of draft.entries) {
		const reason = checkEvidence(entry, signalsByName, allowedSourceUrls);
		if (reason !== null) {
			dropped++;
			console.warn(`  ⚠ Dropping ${entry.id}: ${reason}`);
			continue;
		}
		kept.push(entry);
	}
	console.log(`  ${kept.length} entries with valid evidence, ${dropped} dropped.`);
	return { ...draft, entries: kept };
}

function checkEvidence(
	entry: SeasonalStatusEntryWithEvidence,
	signalsByName: Map<string, VerifiedSignal[]>,
	allowedSourceUrls: Set<string>,
): string | null {
	if (!entry.evidence || typeof entry.evidence !== 'object') {
		return 'missing evidence field';
	}
	const { source_name, quote } = entry.evidence;
	if (typeof source_name !== 'string' || typeof quote !== 'string') {
		return 'evidence has wrong shape';
	}
	const candidates = signalsByName.get(source_name);
	if (!candidates) {
		return `evidence.source_name "${source_name}" did not appear in verified signals`;
	}
	const needle = normaliseForMatch(quote);
	const match = candidates.find((c) => normaliseForMatch(c.quote) === needle);
	if (!match) {
		return `evidence.quote did not match any verified signal from ${source_name}`;
	}
	if (entry.sourceUrl && !allowedSourceUrls.has(entry.sourceUrl)) {
		return `sourceUrl "${entry.sourceUrl}" not in fetched-source allowlist`;
	}
	return null;
}

// ---- Opus critic (prompt-cached) -------------------------------------------

async function runCritic(
	client: Anthropic,
	draft: SeasonalStatusDraft,
	signals: VerifiedSignal[],
): Promise<SeasonalStatusDraft> {
	if (draft.entries.length === 0) {
		console.log('  (no entries to review)');
		return draft;
	}

	const system = [
		`You are a strict editorial reviewer for a hiker-safety data file. For each entry in the ` +
			`candidate JSON below, decide whether the entry is fully supported by the verified ` +
			`signals provided. An entry is supported only if the signals explicitly mention:`,
		`  - the hazard or condition`,
		`  - the location or region`,
		`  - the timing (or the entry uses a conservative 14-day window from today)`,
		`Severity in the entry must not exceed what the signals state. Treat paraphrase, ` +
			`extrapolation, or "this is probably still true" as NOT supported.`,
		``,
		`Reply with one JSON object: { "verdicts": [ { "id": "...", "supported": true|false, "reason": "..." } ] }`,
		`Include one verdict per entry, in the same order. No prose outside the JSON.`,
	].join('\n');

	const user = [
		`VERIFIED SIGNALS:`,
		``,
		signals.length === 0
			? '(no signals)'
			: signals
					.map(
						(s, i) =>
							`Signal ${i + 1} (${s.source_name}): region="${s.region}" hazard="${s.hazard}" ` +
							`severity_guess="${s.severity_guess}" valid_window="${s.valid_window}" quote=${JSON.stringify(s.quote)}`,
					)
					.join('\n'),
		``,
		`CANDIDATE ENTRIES (review each against the signals above):`,
		``,
		JSON.stringify(draft.entries, null, 2),
		``,
		`Output the verdicts JSON now.`,
	].join('\n');

	const response = await client.messages.create({
		model: CRITIC_MODEL,
		max_tokens: 4000,
		system: [
			{
				type: 'text',
				text: system,
				cache_control: { type: 'ephemeral' },
			},
		],
		messages: [{ role: 'user', content: user }],
	});

	logCacheUsage('critic', response.usage);

	const raw = response.content
		.filter((b): b is Anthropic.TextBlock => b.type === 'text')
		.map((b) => b.text)
		.join('\n');

	let verdicts: CriticVerdict[];
	try {
		const parsed = parseJsonObject<{ verdicts?: CriticVerdict[] }>(raw);
		verdicts = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
	} catch (err) {
		fail(`Critic returned unparseable JSON: ${(err as Error).message}`);
	}

	const verdictById = new Map(verdicts.map((v) => [v.id, v]));
	const kept: SeasonalStatusEntryWithEvidence[] = [];
	const rejected: CriticVerdict[] = [];
	for (const entry of draft.entries) {
		const v = verdictById.get(entry.id);
		if (!v) {
			rejected.push({ id: entry.id, supported: false, reason: 'no verdict returned' });
			continue;
		}
		if (v.supported) {
			kept.push(entry);
		} else {
			rejected.push(v);
		}
	}

	for (const v of rejected) {
		console.warn(`  ⚠ Critic rejected ${v.id}: ${v.reason}`);
	}
	const approvalRatio = draft.entries.length === 0 ? 1 : kept.length / draft.entries.length;
	console.log(
		`  Critic approved ${kept.length}/${draft.entries.length} entries (${(approvalRatio * 100).toFixed(0)}%).`,
	);
	if (approvalRatio < MIN_CRITIC_APPROVAL_RATIO) {
		fail(
			`Critic approval ratio ${(approvalRatio * 100).toFixed(0)}% is below the ` +
				`${(MIN_CRITIC_APPROVAL_RATIO * 100).toFixed(0)}% floor. Aborting rather than ship a low-confidence file.`,
		);
	}

	return { ...draft, entries: kept };
}

// ---- Evidence stripping ----------------------------------------------------

function stripEvidence(draft: SeasonalStatusDraft): SeasonalStatusFile {
	return {
		...draft,
		entries: draft.entries.map((e) => {
			const { evidence: _evidence, ...clean } = e;
			return clean;
		}),
	};
}

// ---- Cache usage logging ---------------------------------------------------

function logCacheUsage(
	label: string,
	usage: {
		input_tokens?: number;
		output_tokens?: number;
		cache_creation_input_tokens?: number | null;
		cache_read_input_tokens?: number | null;
	},
): void {
	const cacheRead = usage.cache_read_input_tokens ?? 0;
	const cacheCreate = usage.cache_creation_input_tokens ?? 0;
	const hot = cacheRead > 0;
	console.log(
		`  [${label}] in=${usage.input_tokens ?? 0} out=${usage.output_tokens ?? 0} ` +
			`cache_create=${cacheCreate} cache_read=${cacheRead} ${hot ? '(cache HIT)' : '(cache MISS / first-run)'}`,
	);
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
		console.log(`  + ${e.id}  (${e.severity}, ${e.validFrom} -> ${e.validUntil})`);
	}
	for (const e of removed) {
		console.log(`  - ${e.id}`);
	}
	for (const e of modified) {
		console.log(`  ~ ${e.id}  (${e.severity}, ${e.validFrom} -> ${e.validUntil})`);
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
