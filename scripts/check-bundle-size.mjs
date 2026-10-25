/**
 * CI guard: fails when client JS grows past budget. Run after `next build`.
 *
 * Three checks:
 *  - First-load core: the rootMainFiles entry chunks every visitor downloads
 *    before anything renders. Catches a lazy-loaded heavy dep (docx, jspdf,
 *    html-to-image) accidentally becoming an eager import.
 *  - Total client JS: every chunk under .next/static/chunks. Catches general
 *    dependency creep even when it hides behind a dynamic import.
 *  - Largest chunk: any single chunk, eager or async. Catches a large data file
 *    or dependency landing in one chunk, which the first-load check misses
 *    when that chunk is not a root entry (the full Croatia boundary GeoJSON
 *    once sat in the map's chunk this way).
 *
 * Budgets are intentionally generous (current + headroom) so the check only
 * trips on real regressions, not routine feature work. Adjust here when a
 * deliberate increase is accepted.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FIRST_LOAD_BUDGET_KB = 550; // measured 446 KB raw on 2026-06-10
const TOTAL_BUDGET_KB = 6144; // 6 MB ceiling; last measured 5305 KB raw on 2026-07-11 (lazy FIT SDK + recharts/jspdf chunks)
const LARGEST_CHUNK_BUDGET_KB = 600; // measured 466 KB raw on 2026-10-25

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextDir = path.join(projectRoot, '.next');

function listJsFiles(dir) {
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) files.push(...listJsFiles(full));
		else if (entry.name.endsWith('.js')) files.push({ file: full, bytes: statSync(full).size });
	}
	return files;
}

let manifest;
try {
	manifest = JSON.parse(readFileSync(path.join(nextDir, 'build-manifest.json'), 'utf8'));
} catch {
	console.error('[bundle-size] .next/build-manifest.json not found - run `next build` first.');
	process.exit(1);
}

const rootFiles = manifest.rootMainFiles ?? [];
const firstLoadKb = Math.round(rootFiles.reduce((sum, f) => sum + statSync(path.join(nextDir, f)).size, 0) / 1024);
const chunks = listJsFiles(path.join(nextDir, 'static', 'chunks'));
const totalKb = Math.round(chunks.reduce((sum, c) => sum + c.bytes, 0) / 1024);
const largest = chunks.reduce((max, c) => (c.bytes > max.bytes ? c : max), { file: '', bytes: 0 });
const largestKb = Math.round(largest.bytes / 1024);
const largestName = path.relative(nextDir, largest.file);

console.log(`[bundle-size] first-load core: ${firstLoadKb} KB (budget ${FIRST_LOAD_BUDGET_KB} KB)`);
console.log(`[bundle-size] total client JS: ${totalKb} KB (budget ${TOTAL_BUDGET_KB} KB)`);
console.log(`[bundle-size] largest chunk: ${largestKb} KB, ${largestName} (budget ${LARGEST_CHUNK_BUDGET_KB} KB)`);

let failed = false;
if (rootFiles.length === 0) {
	console.error('[bundle-size] rootMainFiles missing from build manifest; first-load check skipped.');
} else if (firstLoadKb > FIRST_LOAD_BUDGET_KB) {
	console.error(
		`[bundle-size] FAIL: first-load core exceeds budget by ${firstLoadKb - FIRST_LOAD_BUDGET_KB} KB. ` +
			'Did a heavy dependency become an eager import?',
	);
	failed = true;
}
if (totalKb > TOTAL_BUDGET_KB) {
	console.error(`[bundle-size] FAIL: total client JS exceeds budget by ${totalKb - TOTAL_BUDGET_KB} KB.`);
	failed = true;
}
if (largestKb > LARGEST_CHUNK_BUDGET_KB) {
	console.error(
		`[bundle-size] FAIL: ${largestName} exceeds the per-chunk budget by ${largestKb - LARGEST_CHUNK_BUDGET_KB} KB. ` +
			'Did a large data file or dependency land in one chunk?',
	);
	failed = true;
}
process.exit(failed ? 1 : 0);
