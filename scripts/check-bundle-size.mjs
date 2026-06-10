/**
 * CI guard: fails when client JS grows past budget. Run after `next build`.
 *
 * Two checks:
 *  - First-load core: the rootMainFiles entry chunks every visitor downloads
 *    before anything renders. Catches a lazy-loaded heavy dep (docx, jspdf,
 *    html-to-image) accidentally becoming an eager import.
 *  - Total client JS: every chunk under .next/static/chunks. Catches general
 *    dependency creep even when it hides behind a dynamic import.
 *
 * Budgets are intentionally generous (current + headroom) so the check only
 * trips on real regressions, not routine feature work. Adjust here when a
 * deliberate increase is accepted.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FIRST_LOAD_BUDGET_KB = 550; // measured 446 KB raw on 2026-06-10
const TOTAL_BUDGET_KB = 5000; // measured 4204 KB raw on 2026-06-10

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextDir = path.join(projectRoot, '.next');

function walkJsBytes(dir) {
	let total = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) total += walkJsBytes(full);
		else if (entry.name.endsWith('.js')) total += statSync(full).size;
	}
	return total;
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
const totalKb = Math.round(walkJsBytes(path.join(nextDir, 'static', 'chunks')) / 1024);

console.log(`[bundle-size] first-load core: ${firstLoadKb} KB (budget ${FIRST_LOAD_BUDGET_KB} KB)`);
console.log(`[bundle-size] total client JS: ${totalKb} KB (budget ${TOTAL_BUDGET_KB} KB)`);

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
process.exit(failed ? 1 : 0);
