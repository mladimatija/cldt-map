/**
 * Tile layers whose images load with CORS. A canvas drawn from an image loaded
 * without CORS cannot be read back, which made every map export fail on the
 * clipped base map, and with CORS the service worker stores readable copies.
 *
 * Earlier versions stored tiles as opaque copies, which the browser does not
 * accept as the answer to a CORS request. Online the service worker replaces
 * such a copy with a readable one; offline it answers with an error, and these
 * layers then load that tile once more without CORS, which the old copy answers.
 * Client-only (imports Leaflet).
 */
import L from 'leaflet';
import { findStoredTile } from '@/lib/tile-cache';

/** True when the service worker holds `url` only as an opaque copy, which a
 *  request without CORS can still use. */
async function hasOpaqueTileCopy(url: string): Promise<boolean> {
	if (!navigator.serviceWorker?.controller) return false;
	return (await findStoredTile(url))?.type === 'opaque';
}

class CorsTileLayer extends L.TileLayer {
	/** Called by Leaflet when a tile image fails to load. */
	protected override _tileOnError(done: L.DoneCallback, tile: HTMLElement, error: Error): void {
		const image = tile as HTMLImageElement;
		const url = image.src;
		if (image.crossOrigin === null) {
			super._tileOnError(done, tile, error);
			return;
		}
		void hasOpaqueTileCopy(url).then((opaque) => {
			// A tile Leaflet has dropped meanwhile has a blank src.
			if (opaque && image.src === url) {
				image.crossOrigin = null;
				image.src = url;
			} else {
				super._tileOnError(done, tile, error);
			}
		});
	}
}

/** A tile layer whose images load with CORS. Only for hosts that send
 *  `Access-Control-Allow-Origin`: anywhere else no tile would load. */
export function corsTileLayer(url: string, options: L.TileLayerOptions): L.TileLayer {
	return new CorsTileLayer(url, { ...options, crossOrigin: true });
}

function loadImage(url: string, cors: boolean): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		if (cors) image.crossOrigin = '';
		image.onload = () => resolve(image);
		image.onerror = reject;
		image.src = url;
	});
}

/** Loads a tile image, with CORS when `cors` is set. A tile the service worker
 *  holds only as an opaque copy is loaded again without CORS. */
async function loadTileImage(url: string, cors: boolean): Promise<HTMLImageElement> {
	if (!cors) return loadImage(url, false);
	try {
		return await loadImage(url, true);
	} catch (error) {
		if (!(await hasOpaqueTileCopy(url))) throw error;
		return loadImage(url, false);
	}
}

/** A tile's place against the clip boundary, from BoundaryCanvas: wholly
 *  outside, wholly inside, or the boundary rings (zoom 0 pixels) crossing it. */
interface TileGeometry {
	isOut?: boolean;
	isIn?: boolean;
	geometry?: L.Point[][][];
}

/** The BoundaryCanvas internal the override below uses (leaflet-boundary-canvas 1.0). */
interface BoundaryCanvasGeometry {
	_getTileGeometry(x: number, y: number, zoom: number): TileGeometry;
}

export type BoundaryCanvasConstructor = new (url: string, options: object) => L.TileLayer;

/** Draws `image` into a tile canvas, clipped to the boundary rings unless the
 *  tile lies wholly inside, as BoundaryCanvas draws it. */
function drawClippedTile(
	canvas: HTMLCanvasElement,
	image: HTMLImageElement,
	state: TileGeometry,
	coords: L.Coords,
	zoom: number,
): void {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	if (!state.isIn && state.geometry) {
		const scale = 2 ** zoom;
		const tileX = canvas.width * coords.x;
		const tileY = canvas.height * coords.y;
		ctx.beginPath();
		for (const polygon of state.geometry) {
			for (const ring of polygon) {
				if (ring.length === 0) {
					continue;
				}
				ctx.moveTo(ring[0].x * scale - tileX, ring[0].y * scale - tileY);
				for (let i = 1; i < ring.length; i++) {
					ctx.lineTo(ring[i].x * scale - tileX, ring[i].y * scale - tileY);
				}
			}
		}
		ctx.clip();
	}
	ctx.drawImage(image, 0, 0);
}

let corsBoundaryCanvasClass: BoundaryCanvasConstructor | null = null;

/**
 * BoundaryCanvas with its tile drawing replaced. The plugin loads each image
 * without CORS, so its canvases could not be exported. It also never reported
 * a failed tile, and reported a tile outside the boundary before Leaflet had
 * registered it, which dropped the report: either kept the layer loading, so
 * the exports sat out their whole tile wait.
 */
export function corsBoundaryCanvas(BoundaryCanvas: BoundaryCanvasConstructor): BoundaryCanvasConstructor {
	if (corsBoundaryCanvasClass) return corsBoundaryCanvasClass;
	const Base = BoundaryCanvas as unknown as new (url: string, options: object) => L.TileLayer & BoundaryCanvasGeometry;
	class CorsBoundaryCanvas extends Base {
		/** Called by BoundaryCanvas's createTile for each tile; `done` reports it drawn. */
		_drawTileInternal(
			canvas: HTMLCanvasElement & { complete?: boolean },
			coords: L.Coords,
			url: string,
			done: () => void,
		): void {
			const zoom = this._getZoomForUrl();
			const state = this._getTileGeometry(coords.x, coords.y, zoom);
			if (state.isOut) {
				// After createTile returns, once Leaflet has registered the tile.
				queueMicrotask(done);
				return;
			}
			loadTileImage(url, Boolean(this.options.crossOrigin)).then(
				(image) => {
					// Leaflet reads `complete` to tell loaded tiles from pending ones.
					canvas.complete = true;
					drawClippedTile(canvas, image, state, coords, zoom);
					done();
				},
				// A tile that cannot load stays blank but counts as done, so the layer finishes loading.
				() => done(),
			);
		}
	}
	corsBoundaryCanvasClass = CorsBoundaryCanvas;
	return corsBoundaryCanvasClass;
}
