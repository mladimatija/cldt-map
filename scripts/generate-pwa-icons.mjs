#!/usr/bin/env node
/**
 * Generates PWA icons (192x192 and 512x512 PNG) from public/cldt-logo.svg.
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
  for (const size of [192, 512]) {
    const outPath = join(outDir, `icon-${size}.png`);
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`Written ${outPath}`);
  }
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
