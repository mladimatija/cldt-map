/**
 * Per-day elevation profile thumbnails for the trip brief exporters.
 *
 * Renders a small filled area chart of the day's km window to an offscreen
 * canvas and returns a PNG data URL. Runs only client-side (canvas); the
 * exporters treat a missing thumbnail as "skip the image", so SSR or a
 * degenerate window cannot break an export.
 */

export interface ElevationProfilePoint {
	elevation: number;
	distanceFromStart: number;
}

/** Canvas pixel size; drawn at 2x the printed size for crisp PDF output. */
const W = 1044;
const H = 180;
const PAD_X = 8;
const PAD_TOP = 22;
const PAD_BOTTOM = 14;

/**
 * Returns a PNG data URL of the elevation profile between startKm and endKm,
 * drawn left-to-right in the direction of travel (reversed for NOBO), or
 * null when the window has too few points or canvas is unavailable.
 */
export function renderElevationThumbnail(
	points: readonly ElevationProfilePoint[],
	startKm: number,
	endKm: number,
	nobo: boolean,
): string | null {
	if (typeof document === 'undefined') return null;
	const loM = Math.min(startKm, endKm) * 1000;
	const hiM = Math.max(startKm, endKm) * 1000;
	const slice = points.filter((p) => p.distanceFromStart >= loM && p.distanceFromStart <= hiM);
	if (slice.length < 2) return null;
	const ordered = nobo ? [...slice].reverse() : slice;

	let minEle = Infinity;
	let maxEle = -Infinity;
	for (const p of ordered) {
		if (p.elevation < minEle) minEle = p.elevation;
		if (p.elevation > maxEle) maxEle = p.elevation;
	}
	if (!Number.isFinite(minEle) || !Number.isFinite(maxEle)) return null;
	const span = Math.max(50, maxEle - minEle);

	const canvas = document.createElement('canvas');
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;

	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, W, H);

	const innerW = W - PAD_X * 2;
	const innerH = H - PAD_TOP - PAD_BOTTOM;
	const x = (i: number): number => PAD_X + (i / (ordered.length - 1)) * innerW;
	const y = (ele: number): number => PAD_TOP + (1 - (ele - minEle) / span) * innerH;

	// Filled area
	ctx.beginPath();
	ctx.moveTo(x(0), H - PAD_BOTTOM);
	for (let i = 0; i < ordered.length; i++) ctx.lineTo(x(i), y(ordered[i].elevation));
	ctx.lineTo(x(ordered.length - 1), H - PAD_BOTTOM);
	ctx.closePath();
	ctx.fillStyle = 'rgba(34, 139, 84, 0.18)';
	ctx.fill();

	// Profile line
	ctx.beginPath();
	for (let i = 0; i < ordered.length; i++) {
		if (i === 0) ctx.moveTo(x(i), y(ordered[i].elevation));
		else ctx.lineTo(x(i), y(ordered[i].elevation));
	}
	ctx.strokeStyle = '#228b54';
	ctx.lineWidth = 3;
	ctx.stroke();

	// Min/max labels, top-left and bottom-left
	ctx.fillStyle = '#666666';
	ctx.font = '20px sans-serif';
	ctx.textBaseline = 'top';
	ctx.fillText(`${Math.round(maxEle)} m`, PAD_X + 2, 2);
	ctx.textBaseline = 'bottom';
	ctx.fillText(`${Math.round(minEle)} m`, PAD_X + 2, H - 1);

	return canvas.toDataURL('image/png');
}

/** Data-URL PNG -> raw bytes for docx's ImageRun. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
	const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
	const bin = atob(base64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}
