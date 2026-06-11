/**
 * Pack list CSV import (LighterPack, Packstack, and compatible exports).
 *
 * Header-driven: columns are located by name (case-insensitive, partial
 * match) rather than position, so LighterPack's
 * `Item Name,Category,desc,qty,weight,unit,url,price,worn,consumable`
 * and Packstack's variants both parse without format switches. All weights
 * are normalized to kg.
 *
 * Base weight follows the ultralight convention: total of carried gear
 * excluding worn items and consumables.
 */

export interface PackItem {
	name: string;
	category: string;
	/** Weight of one unit in kg. */
	kg: number;
	qty: number;
	worn: boolean;
	consumable: boolean;
}

export interface PackCategorySummary {
	name: string;
	kg: number;
	itemCount: number;
}

export interface PackList {
	/** Source filename, kept for the settings summary line. */
	sourceName: string;
	importedAt: string;
	items: PackItem[];
	categories: PackCategorySummary[];
	/** Carried gear excluding worn and consumables (kg). */
	baseKg: number;
	wornKg: number;
	consumableKg: number;
	totalKg: number;
}

const KG_PER: Record<string, number> = {
	gram: 0.001,
	g: 0.001,
	kilogram: 1,
	kg: 1,
	ounce: 0.0283495,
	oz: 0.0283495,
	pound: 0.453592,
	lb: 0.453592,
	lbs: 0.453592,
};

/** Minimal CSV parser with quote support; returns rows of cells.
 *
 *  Matches the quirks of the real exporters (verified against
 *  lighterpack/server/views.js and Packstack-Tech/app/src/lib/download.ts):
 *  LighterPack only quotes fields containing commas, so a bare `"` can
 *  appear mid-cell unquoted (item names like `2" stakes`) - a quote only
 *  opens quoted mode at the START of a cell, anywhere else it is literal.
 *  Packstack quotes commas, quotes, and newlines RFC-style; newlines inside
 *  quoted cells (multi-line notes) are preserved. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					cell += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				cell += ch;
			}
		} else if (ch === '"' && cell === '') {
			inQuotes = true;
		} else if (ch === '"') {
			cell += ch;
		} else if (ch === ',') {
			row.push(cell);
			cell = '';
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && text[i + 1] === '\n') i++;
			row.push(cell);
			cell = '';
			if (row.some((c) => c.trim() !== '')) rows.push(row);
			row = [];
		} else {
			cell += ch;
		}
	}
	row.push(cell);
	if (row.some((c) => c.trim() !== '')) rows.push(row);
	return rows;
}

/** Column index by fuzzy header name; -1 when absent. */
function findColumn(header: string[], ...names: string[]): number {
	const lower = header.map((h) => h.trim().toLowerCase());
	for (const name of names) {
		const exact = lower.indexOf(name);
		if (exact !== -1) return exact;
	}
	for (const name of names) {
		const partial = lower.findIndex((h) => h.includes(name));
		if (partial !== -1) return partial;
	}
	return -1;
}

function truthyFlag(value: string | undefined): boolean {
	if (!value) return false;
	const v = value.trim().toLowerCase();
	return v !== '' && v !== '0' && v !== 'false' && v !== 'no';
}

/**
 * Parses a pack list CSV into a normalized PackList, or throws with a
 * `pack-csv:` prefixed message the UI maps to a localized error. The file
 * must have a header row containing at least an item/name column and a
 * weight column.
 */
export function parsePackCsv(text: string, sourceName: string): PackList {
	const rows = parseCsv(text);
	if (rows.length < 2) throw new Error('pack-csv: no data rows');
	const header = rows[0];

	const nameCol = findColumn(header, 'item name', 'item', 'name');
	const weightCol = findColumn(header, 'weight');
	if (nameCol === -1 || weightCol === -1) throw new Error('pack-csv: missing name or weight column');
	const categoryCol = findColumn(header, 'category');
	const unitCol = findColumn(header, 'unit');
	const qtyCol = findColumn(header, 'qty', 'quantity', 'amount');
	const wornCol = findColumn(header, 'worn');
	const consumableCol = findColumn(header, 'consumable');

	const items: PackItem[] = [];
	for (const row of rows.slice(1)) {
		const name = (row[nameCol] ?? '').trim();
		const rawWeight = Number((row[weightCol] ?? '').replace(',', '.'));
		if (!name || !Number.isFinite(rawWeight) || rawWeight < 0) continue;
		const unit = unitCol !== -1 ? (row[unitCol] ?? '').trim().toLowerCase() : 'gram';
		const factor = KG_PER[unit] ?? (unit === '' ? 0.001 : NaN);
		if (!Number.isFinite(factor)) continue;
		const qtyRaw = qtyCol !== -1 ? Number(row[qtyCol]) : 1;
		const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
		items.push({
			name,
			category: categoryCol !== -1 ? (row[categoryCol] ?? '').trim() || '-' : '-',
			kg: rawWeight * factor,
			qty,
			worn: wornCol !== -1 && truthyFlag(row[wornCol]),
			consumable: consumableCol !== -1 && truthyFlag(row[consumableCol]),
		});
	}
	if (items.length === 0) throw new Error('pack-csv: no parsable items');

	let baseKg = 0;
	let wornKg = 0;
	let consumableKg = 0;
	const byCategory = new Map<string, PackCategorySummary>();
	for (const item of items) {
		const w = item.kg * item.qty;
		if (item.worn) wornKg += w;
		else if (item.consumable) consumableKg += w;
		else baseKg += w;
		const cat = byCategory.get(item.category) ?? { name: item.category, kg: 0, itemCount: 0 };
		cat.kg += w;
		cat.itemCount += 1;
		byCategory.set(item.category, cat);
	}

	return {
		sourceName,
		importedAt: new Date().toISOString(),
		items,
		categories: [...byCategory.values()].sort((a, b) => b.kg - a.kg),
		baseKg,
		wornKg,
		consumableKg,
		totalKg: baseKg + wornKg + consumableKg,
	};
}

/**
 * Best-effort screening of seasonal "recommended gear" text against the
 * imported item names: returns the comma/slash-separated gear terms that do
 * not appear as a substring of any item name. Term matching is shallow on
 * purpose - the dataset's gear strings are free text in mixed languages, so
 * this can only flag candidates for the hiker to double-check, never clear
 * them definitively.
 */
export function missingGearTerms(recommendedGear: readonly string[], pack: PackList): string[] {
	const haystack = pack.items.map((i) => i.name.toLowerCase());
	const missing: string[] = [];
	const seen = new Set<string>();
	for (const gearLine of recommendedGear) {
		for (const term of gearLine.split(/[,;/]+/)) {
			const needle = term.trim().toLowerCase();
			if (needle.length < 3 || seen.has(needle)) continue;
			seen.add(needle);
			if (!haystack.some((h) => h.includes(needle))) missing.push(term.trim());
		}
	}
	return missing;
}
