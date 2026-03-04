#!/usr/bin/env node
/**
 * Generates PWA + iOS + favicon PNG assets from public/cldt-logo.svg.
 * Run: npm run generate-pwa-icons
 * Requires: npm install -D sharp
 */

import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const svgPath = join(root, 'public', 'cldt-logo.svg');
const outDir = join(root, 'public');

const svg = readFileSync(svgPath);

async function generate() {
	const outputs = [
		{ file: 'icon-192.png', size: 192 },
		{ file: 'icon-512.png', size: 512 },
		{ file: 'apple-touch-icon.png', size: 180 },
		{ file: 'favicon-32.png', size: 32 },
		{ file: 'favicon-16.png', size: 16 },
	];

	for (const { file, size } of outputs) {
		const outPath = join(outDir, file);
		await sharp(svg).resize(size, size).png().toFile(outPath);
		console.log(`Written ${outPath}`);
	}
}

generate().catch((err) => {
	console.error(err);
	process.exit(1);
});
