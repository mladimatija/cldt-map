/**
 * CI guard: every locale file in messages/ must expose exactly the same set
 * of (flattened) keys as messages/en.json. Catches dead keys and missing
 * translations before they reach runtime, where next-intl silently falls
 * back and masks the drift.
 *
 * Usage: node scripts/check-i18n-parity.mjs
 * Exits 1 listing per-locale differences when parity is broken.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const messagesDir = path.join(projectRoot, 'messages');
const BASE_LOCALE = 'en';

function flattenKeys(obj, prefix = '') {
	const keys = new Set();
	for (const [key, value] of Object.entries(obj)) {
		const full = prefix ? `${prefix}.${key}` : key;
		if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
			for (const nested of flattenKeys(value, full)) keys.add(nested);
		} else {
			keys.add(full);
		}
	}
	return keys;
}

function loadLocale(file) {
	return flattenKeys(JSON.parse(readFileSync(path.join(messagesDir, file), 'utf8')));
}

const localeFiles = readdirSync(messagesDir)
	.filter((f) => f.endsWith('.json'))
	.sort();
const baseFile = `${BASE_LOCALE}.json`;
if (!localeFiles.includes(baseFile)) {
	console.error(`[i18n-parity] Base locale file messages/${baseFile} not found.`);
	process.exit(1);
}

const baseKeys = loadLocale(baseFile);
let failed = false;

for (const file of localeFiles) {
	if (file === baseFile) continue;
	const keys = loadLocale(file);
	const missing = [...baseKeys].filter((k) => !keys.has(k)).sort();
	const extra = [...keys].filter((k) => !baseKeys.has(k)).sort();
	if (missing.length || extra.length) {
		failed = true;
		console.error(`[i18n-parity] messages/${file} is out of sync with ${baseFile}:`);
		for (const k of missing) console.error(`  missing: ${k}`);
		for (const k of extra) console.error(`  extra:   ${k}`);
	}
}

if (failed) {
	process.exit(1);
}
console.log(`[i18n-parity] ${localeFiles.length} locale files in sync (${baseKeys.size} keys).`);
