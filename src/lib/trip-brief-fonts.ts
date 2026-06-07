/**
 * Font loader for the trip-brief PDF generator.
 *
 * jsPDF ships with helvetica encoded in WinAnsi (CP1252), which cannot
 * represent the Croatian (č ć š ž đ) and Latin Extended-A characters used in
 * our HR and DE strings. To get full diacritic coverage we embed a custom TTF
 * (Noto Sans, SIL Open Font License v1.1) and register it with jsPDF's VFS.
 *
 * Source: https://github.com/googlefonts/noto-fonts (hinted/ttf/NotoSans/)
 * Subset rationale: the upstream Regular + Bold TTFs are ~570 KB each because
 * they cover hundreds of scripts. We only need Basic Latin (U+0020-007E),
 * Latin-1 Supplement (U+00A0-00FF, covers German umlauts and ß), Latin
 * Extended-A (U+0100-017F, covers Croatian č/ć/š/ž/đ), plus a handful of
 * common punctuation glyphs (general-punctuation block, bullet, ellipsis,
 * euro sign). Subsetted with pyftsubset down to ~79 KB per face, so both
 * faces together add ~160 KB to the trip-brief code path - acceptable for a
 * feature that the user explicitly opts into.
 */

import type { jsPDF } from 'jspdf';

const FONT_REGULAR_PATH = '/fonts/NotoSans-Regular.ttf';
const FONT_BOLD_PATH = '/fonts/NotoSans-Bold.ttf';
const FONT_FAMILY = 'NotoSans';

const cachedFontBase64: { regular?: string; bold?: string } = {};

async function fetchFontBase64(path: string): Promise<string> {
	const res = await fetch(path);
	if (!res.ok) throw new Error(`Failed to fetch font ${path}: ${res.status}`);
	const buf = await res.arrayBuffer();
	const bytes = new Uint8Array(buf);
	let binary = '';
	// Chunk the conversion so we don't blow the call-stack on the apply()
	// path for ~80 KB inputs; building a string char-by-char is simple and
	// fast enough for the size of font we ship.
	for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

/**
 * Registers Noto Sans Regular + Bold on the given jsPDF instance so Croatian
 * and German diacritics render correctly. Fetches and base64-encodes the TTF
 * the first time it's called; subsequent calls reuse the cached encoding so
 * generating multiple briefs in one session pays the network cost once.
 *
 * After this resolves the caller can use `pdf.setFont('NotoSans', 'normal')`
 * and `pdf.setFont('NotoSans', 'bold')`.
 */
export async function registerTripBriefFonts(pdf: jsPDF): Promise<void> {
	if (!cachedFontBase64.regular) cachedFontBase64.regular = await fetchFontBase64(FONT_REGULAR_PATH);
	if (!cachedFontBase64.bold) cachedFontBase64.bold = await fetchFontBase64(FONT_BOLD_PATH);

	pdf.addFileToVFS('NotoSans-Regular.ttf', cachedFontBase64.regular);
	pdf.addFont('NotoSans-Regular.ttf', FONT_FAMILY, 'normal');

	pdf.addFileToVFS('NotoSans-Bold.ttf', cachedFontBase64.bold);
	pdf.addFont('NotoSans-Bold.ttf', FONT_FAMILY, 'bold');
}

/** Font family name to pass to `pdf.setFont(...)` after registration. */
export const TRIP_BRIEF_FONT_FAMILY = FONT_FAMILY;
