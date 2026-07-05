/**
 * Splits the committed public/pois.json into per-type files under
 * public/data/pois/<type>.json (gitignored, regenerated on every build via
 * the npm "prebuild" hook). The client loader fetches only the types the
 * user has enabled and revalidates each file independently, so toggling off
 * the 1.4 MB peak dataset actually saves the transfer.
 *
 * pois.json stays the single committed source of truth; this script is pure
 * derivation. When it has not run (plain `next dev`), the loader falls back
 * to whole-file /pois.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Keep in sync with KNOWN_POI_TYPES in src/lib/poi-types.ts. Empty files are
 *  written for known types absent from the dataset so the client never
 *  mistakes "no entries" for "split not generated". */
const KNOWN_POI_TYPES = [
	'town',
	'settlement',
	'peak',
	'viewpoint',
	'hut',
	'shelter',
	'restaurant',
	'cafe',
	'food',
	'atm',
	'water',
	'crag',
];

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = path.join(projectRoot, 'public', 'pois.json');
const outDir = path.join(projectRoot, 'public', 'data', 'pois');

const file = JSON.parse(readFileSync(srcPath, 'utf8'));
if (!Array.isArray(file.pois)) {
	console.error('[split-pois] public/pois.json has no pois array; aborting.');
	process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const byType = new Map(KNOWN_POI_TYPES.map((t) => [t, []]));
let unknownCount = 0;
for (const poi of file.pois) {
	const bucket = byType.get(poi.type);
	if (bucket) bucket.push(poi);
	else unknownCount++;
}
if (unknownCount > 0) {
	console.warn(`[split-pois] ${unknownCount} POIs have types outside KNOWN_POI_TYPES and were not split.`);
}

for (const [type, pois] of byType) {
	const outPath = path.join(outDir, `${type}.json`);
	writeFileSync(outPath, JSON.stringify({ lastUpdated: file.lastUpdated ?? '', pois }));
}

// Per-type counts manifest: lets the UI show "Town (29)" in the type filter
// without fetching the type files themselves (disabled types are never
// loaded, so counting client-side would undercount).
const counts = Object.fromEntries([...byType.entries()].map(([t, p]) => [t, p.length]));
writeFileSync(
	path.join(outDir, 'manifest.json'),
	JSON.stringify({ lastUpdated: file.lastUpdated ?? '', counts }, null, '\t') + '\n',
);

console.log(
	`[split-pois] wrote ${byType.size} type files + manifest to public/data/pois (` +
		[...byType.entries()].map(([t, p]) => `${t}:${p.length}`).join(', ') +
		')',
);
