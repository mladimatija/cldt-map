// Service worker for CLDT Map (app shell + tiles)

// Build stamp: scripts/stamp-sw-version.mjs (run via npm prebuild) generates
// /sw-version.js with the current commit hash so every deploy gets a fresh
// app-shell cache without anyone remembering to bump a constant. The file is
// gitignored; in dev (or if the stamp is missing) importScripts throws and we
// fall back to the manual version below. Registration uses
// updateViaCache: 'none', so a changed stamp re-triggers SW install.
let buildVersion = null;
try {
	importScripts('/sw-version.js');
	buildVersion = self.CLDT_BUILD_VERSION || null;
} catch {
	// No build stamp available - manual fallback version applies.
}
const CACHE_VERSION = buildVersion || 7;
const CACHE_NAME = `cldt-map-cache-v${CACHE_VERSION}`;
const OFFLINE_URL = '/offline';
const TILE_CACHE_PREFIX = 'cldt-tiles-';

// Tile cache ceiling per provider bucket. The deliberate full-corridor
// pre-cache (zooms 8-14 along 2,200 km) produces tens of thousands of tiles
// that must NOT be evicted - this ceiling only guards against unbounded
// growth from years of casual browsing on top of that. Trim drops the
// oldest-inserted entries (Cache Storage keeps insertion order), and the
// check runs on ~2% of writes so the hot tile path stays cheap.
const MAX_TILES_PER_PROVIDER = 60000;
const TILE_TRIM_TARGET = 55000;
const TILE_TRIM_SAMPLE_RATE = 0.02;

async function trimTileCache(cache) {
    try {
        const keys = await cache.keys();
        if (keys.length <= MAX_TILES_PER_PROVIDER) return;
        const excess = keys.length - TILE_TRIM_TARGET;
        for (let i = 0; i < excess; i++) {
            await cache.delete(keys[i]);
        }
    } catch {
        // best-effort housekeeping; never fail a tile response over it
    }
}

const CORE_ASSETS = [
	'/',
	OFFLINE_URL,
	'/manifest.webmanifest',
	'/cldt-logo.svg',
	'/icon-192.png',
	'/icon-512.png',
	'/data/road-access.json',
	'/data/hgss-stations.json',
	'/data/croatia-boundary-simplified.json',
	// The outline the map draws and clips tiles to, so clipping works offline.
	'/data/croatia-boundary-display.json',
];

/** Pages whose build files are precached with them: the app shell and the
 *  offline fallback, which nothing loads while online. */
const PRECACHED_PAGES = ['/', OFFLINE_URL];

// Tile hosts to cache - keyed by substring match. CARTO (Dark) is deliberately
// absent: its basemap terms forbid caching tiles on the device for more than
// 30 days, so its requests bypass the worker (see the fetch handler) and the
// browser HTTP cache applies CARTO's own 30-day max-age.
const TILE_HOSTS = [
    'tile.openstreetmap.org',
    'tile.opentopomap.org',
    'server.arcgisonline.com',
    'tile-cyclosm.openstreetmap.fr',
    'geoportal.dgu.hr',
];

/** Tile cache from before the CARTO key: it holds only "API key required" watermark tiles. */
const RETIRED_TILE_CACHES = [TILE_CACHE_PREFIX + 'carto'];

/** Returns true if `hostname` is exactly `allowedHost` or a subdomain of it. */
function isAllowedHost(hostname, allowedHost) {
    if (!hostname || !allowedHost) return false;
    return hostname === allowedHost || hostname.endsWith('.' + allowedHost);
}

/** Returns a stable cache-key string from a tile URL hostname. */
function getTileProviderKey(hostname) {
    if (isAllowedHost(hostname, 'openstreetmap.org') && !hostname.includes('cyclosm')) return 'osm';
    if (isAllowedHost(hostname, 'opentopomap.org')) return 'topo';
    if (isAllowedHost(hostname, 'arcgisonline.com')) return 'esri';
    if (hostname.includes('cyclosm')) return 'cyclosm';
    if (isAllowedHost(hostname, 'geoportal.dgu.hr')) return 'dgu';
    return 'other';
}

/** Returns the Cache Storage name for a given tile hostname. */
function getTileCacheName(hostname) {
    return TILE_CACHE_PREFIX + getTileProviderKey(hostname);
}

/** Returns true if the URL looks like a tile request we should cache. */
function isTileRequest(url) {
    return TILE_HOSTS.some((host) => isAllowedHost(url.hostname, host));
}

// ── Croatia geographic clip ──────────────────────────────────────────────────
// The runtime tile cache used to keep every tile the user ever panned over,
// worldwide, bounded only by a 60k-per-provider ceiling - which let casual
// browsing balloon the cache to tens of GB. We now refuse to cache tiles that
// fall outside Croatia. A cheap bounding box rejects the bulk; a simplified
// Croatia outline (loaded once from CORE_ASSETS) then trims the bbox's
// over-inclusion of Bosnia / Slovenia / Hungary / Serbia interiors.
// From the build stamp (scripts/stamp-sw-version.mjs writes src/lib/croatia-bbox.json
// into /sw-version.js). Without a stamp (dev) tiles are cached without the clip.
const CROATIA_BBOX = self.CLDT_CROATIA_BBOX || null;
// Below this zoom a single tile is wider than the country; there are only a
// handful, so keep any in-bbox tile rather than risk dropping one that covers
// Croatia. The polygon refinement applies from this zoom up, where the heavy
// storage (and the over-inclusion) actually lives.
const BOUNDARY_POLYGON_MIN_ZOOM = 11;
const BOUNDARY_URL = '/data/croatia-boundary-simplified.json';

let croatiaRingPromise = null;
/** Lazy-load + memoize the simplified Croatia ring ([[lng,lat],...]) or null. */
function loadCroatiaRing() {
    if (croatiaRingPromise) return croatiaRingPromise;
    croatiaRingPromise = (async () => {
        try {
            const cache = await caches.open(CACHE_NAME);
            let res = await cache.match(BOUNDARY_URL);
            if (!res) res = await fetch(BOUNDARY_URL);
            if (!res || !res.ok) return null;
            const data = await res.json();
            const ring = Array.isArray(data) ? data : data.ring;
            return Array.isArray(ring) && ring.length > 2 ? ring : null;
        } catch {
            return null;
        }
    })();
    return croatiaRingPromise;
}

/** Web-Mercator tile (z/x/y) to its lat/lng bounds. */
function tileLatLngBounds(z, x, y) {
    const n = 2 ** z;
    const lngW = (x / n) * 360 - 180;
    const lngE = ((x + 1) / n) * 360 - 180;
    const latN = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    const latS = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
    return { lngW, lngE, latN, latS };
}

function bboxIntersectsCroatia(b) {
    if (!CROATIA_BBOX) return true;
    return (
        b.lngE >= CROATIA_BBOX.lngMin &&
        b.lngW <= CROATIA_BBOX.lngMax &&
        b.latN >= CROATIA_BBOX.latMin &&
        b.latS <= CROATIA_BBOX.latMax
    );
}

/** Ray-casting point-in-polygon against a [[lng,lat],...] ring. */
function pointInRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0];
        const yi = ring[i][1];
        const xj = ring[j][0];
        const yj = ring[j][1];
        const hit = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
        if (hit) inside = !inside;
    }
    return inside;
}

/** Parse z/x/y from a tile path. ESRI ArcGIS serves /{z}/{y}/{x}; others /{z}/{x}/{y}. */
function parseTileCoords(url, providerKey) {
    const m = url.pathname.match(/\/(\d+)\/(\d+)\/(\d+)(?:\.\w+)?$/);
    if (!m) return null;
    const a = +m[1];
    const b = +m[2];
    const c = +m[3];
    return providerKey === 'esri' ? { z: a, y: b, x: c } : { z: a, x: b, y: c };
}

/** Decide whether a fetched tile may be written to the cache (Croatia-only). */
async function tileShouldBeCached(url, providerKey) {
    // DGU is a WMS layer (no /z/x/y path) serving Croatian state topo only -
    // it is inherently in-bounds, so always allow it.
    if (providerKey === 'dgu') return true;
    const coords = parseTileCoords(url, providerKey);
    if (!coords) return false; // unknown coords on a non-DGU host: fail closed
    const b = tileLatLngBounds(coords.z, coords.x, coords.y);
    if (!bboxIntersectsCroatia(b)) return false;
    if (coords.z < BOUNDARY_POLYGON_MIN_ZOOM) return true; // few large tiles; bbox is enough
    const ring = await loadCroatiaRing();
    if (!ring) return true; // polygon unavailable; bbox already passed
    // Generous: keep the tile if its centre or any corner lands inside Croatia,
    // so coastline and border tiles are not refused.
    const cx = (b.lngW + b.lngE) / 2;
    const cy = (b.latN + b.latS) / 2;
    return (
        pointInRing(cx, cy, ring) ||
        pointInRing(b.lngW, b.latN, ring) ||
        pointInRing(b.lngE, b.latN, ring) ||
        pointInRing(b.lngW, b.latS, ring) ||
        pointInRing(b.lngE, b.latS, ring)
    );
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
    // Intentionally NOT calling self.skipWaiting() here. A new worker must park in
    // the `waiting` state so ServiceWorkerProvider can surface the "Update now"
    // prompt and let the user choose when to switch; skipWaiting runs only in
    // response to the user's SKIP_WAITING message below. (A first install still
    // activates immediately - there is no controller for it to wait behind.)
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            await Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url)));
            await Promise.allSettled(PRECACHED_PAGES.map((page) => precachePageAssets(cache, page)));
        }),
    );
});

/** Precaches the scripts and styles a precached page references, so it also
 *  renders when it is first needed offline. */
async function precachePageAssets(cache, pageUrl) {
    const page = await cache.match(pageUrl);
    if (!page) return;
    const html = await page.text();
    const assets = new Set();
    for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
        assets.add(match[1].replace(/&amp;/g, '&'));
    }
    await Promise.allSettled([...assets].map((url) => cache.add(url)));
}

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const cacheNames = await caches.keys();
            // Remove old versioned app-shell caches and old monolithic tile caches
            await Promise.all(
                cacheNames
                    .filter((name) => {
                        if (RETIRED_TILE_CACHES.includes(name)) return true;
                        if (name === CACHE_NAME) return false;
                        if (name.startsWith(TILE_CACHE_PREFIX)) return false; // keep per-provider caches
                        if (name.startsWith('cldt-map-')) return true; // delete old versioned caches
                        return false;
                    })
                    .map((name) => caches.delete(name)),
            );
            await self.clients.claim();
        })(),
    );
});

// ── Messages ─────────────────────────────────────────────────────────────────

self.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
        return;
    }

    // Notify all clients of SW version (for debugging)
    if (event.data.type === 'GET_VERSION') {
        event.source?.postMessage({type: 'SW_VERSION', version: CACHE_VERSION});
    }
});

// ── Fetch interception ───────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
    const req = event.request;

    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // CARTO tiles go straight to the network (no respondWith), so the worker never
    // stores them; see TILE_HOSTS.
    if (isAllowedHost(url.hostname, 'cartocdn.com')) return;

    // Tile requests: cache-first with per-provider caching
    if (isTileRequest(url)) {
        event.respondWith(handleTileRequest(event, url));
        return;
    }

    // Other cross-origin requests (weather, Wikipedia, geocoding) go to the network
    // untouched: a cached copy would answer with stale data forever.
    if (url.origin !== self.location.origin) return;

    // Navigation requests: network-first, offline fallback
    if (req.mode === 'navigate') {
        event.respondWith(handleNavigationRequest(event, url));
        return;
    }

    // API routes and React Server Component fetches are dynamic: never cached.
    if (url.pathname.startsWith('/api/') || url.searchParams.has('_rsc') || req.headers.get('RSC') === '1') {
        return;
    }

    // Build output is content-hashed, so a cached copy is always current.
    if (url.pathname.startsWith('/_next/static/')) {
        event.respondWith(handleImmutableRequest(event));
        return;
    }

    // Data files (/data/*, /*.json) and the other static files: network-first,
    // cache fallback
    event.respondWith(handleGenericGetRequest(event));
});

// ── Request handlers ─────────────────────────────────────────────────────────
// Handlers return the network response at once and finish cache writes under
// event.waitUntil, so a page never waits for a disk write.

/** Stores a copy of `response` under `key` in the app-shell cache, in the background. */
function cacheInBackground(event, key, response) {
    const copy = response.clone();
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(key, copy))
            .catch(() => {
                // best-effort; the next successful fetch writes it again
            }),
    );
}

/** How long a map tile stored as an opaque copy waits for a readable copy
 *  before it falls back to the old copy (see upgradeOpaqueTile). */
const OPAQUE_UPGRADE_TIMEOUT_MS = 2000;

/** Tile hosts that send no CORS headers, which the map loads without CORS (the
 *  `cors` flag in map-service-config): a CORS request never gets a readable copy. */
const NO_CORS_TILE_HOSTS = ['geoportal.dgu.hr'];

async function handleTileRequest(event, url) {
    const request = event.request;
    const cache = await caches.open(getTileCacheName(url.hostname));

    const cachedResponse = await cache.match(request.url || request);
    if (cachedResponse) {
        // Map tiles load with CORS, and the browser rejects an opaque copy (stored
        // by earlier versions, which loaded tiles without CORS) as the answer to one.
        if (cachedResponse.type !== 'opaque' || request.mode === 'no-cors') return cachedResponse;
        return upgradeOpaqueTile(event, cache, request, url);
    }

    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok || networkResponse.type === 'opaque') {
            const stored = storeTile(event, cache, request, url, networkResponse.clone());
            // Map tiles (<img>) are shown at once and written in the background. The
            // corridor download fetches from script and waits for each write, so its
            // progress counts stored tiles and its batches keep pace with the disk.
            if (request.destination === 'image') event.waitUntil(stored);
            else await stored;
        }
        return networkResponse;
    } catch {
        // Network failed. A script fetch (the corridor download, a map export) gets
        // an error, so it counts the tile as missing; a map tile gets a placeholder.
        if (request.destination !== 'image') return Response.error();
        const svg =
            '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">' +
            '<rect width="256" height="256" fill="#e5e7eb"/>' +
            '<text x="128" y="136" font-family="sans-serif" font-size="14" fill="#6b7280" text-anchor="middle">Offline</text>' +
            '</svg>';
        return new Response(svg, {
            status: 200,
            headers: {'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store'},
        });
    }
}

/**
 * Answers a CORS request for a tile stored as an opaque copy with a readable copy
 * from the network, which replaces the old one. Offline it answers with an error,
 * and so it does for a map tile when the network takes longer than
 * OPAQUE_UPGRADE_TIMEOUT_MS: the page then asks again without CORS, which the old
 * copy answers at once. A script fetch (a map export) has no such fallback, so it
 * waits for the download.
 */
async function upgradeOpaqueTile(event, cache, request, url) {
    if (self.navigator.onLine === false) return Response.error();
    if (NO_CORS_TILE_HOSTS.some((host) => isAllowedHost(url.hostname, host))) return Response.error();
    const download = fetch(request).then((response) => {
        if (response.ok) event.waitUntil(storeTile(event, cache, request, url, response.clone()));
        return response;
    });
    // A download that outlasts the wait still replaces the old copy for next time.
    event.waitUntil(download.catch(() => {}));
    let answer = download;
    if (request.destination === 'image') {
        const timeout = new Promise((resolve) => setTimeout(resolve, OPAQUE_UPGRADE_TIMEOUT_MS, null));
        answer = Promise.race([download, timeout]);
    }
    const response = await answer.catch(() => null);
    return response && response.ok ? response : Response.error();
}

/** Writes a fetched tile to its provider cache when it lies in Croatia and tells
 *  the pages when storage is full. Never throws. Trimming now and then runs
 *  alongside, so it never delays a tile. */
async function storeTile(event, cache, request, url, response) {
    try {
        if (!(await tileShouldBeCached(url, getTileProviderKey(url.hostname)))) return;
        await cache.put(request, response);
        if (Math.random() < TILE_TRIM_SAMPLE_RATE) event.waitUntil(trimTileCache(cache));
    } catch (cacheErr) {
        // Storage quota exceeded or other cache write error - the tile was served anyway
        if (cacheErr && cacheErr.name === 'QuotaExceededError') {
            // Notify all clients so the UI can surface a warning
            const clients = await self.clients.matchAll({type: 'window'}).catch(() => []);
            clients.forEach((client) => client.postMessage({type: 'TILE_QUOTA_EXCEEDED'}));
        }
    }
}

async function handleNavigationRequest(event, url) {
    // Keyed by path alone: the page is the same for every query string (share and
    // deep links), so an offline share link still opens the app, and the cache
    // holds one entry per path instead of one per link.
    const cacheKey = url.origin + url.pathname;
    try {
        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200) {
            cacheInBackground(event, cacheKey, networkResponse);
        }
        return networkResponse;
    } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
        const offline = await cache.match(OFFLINE_URL);
        if (offline) return offline;
        return new Response('Offline', {status: 200, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
    }
}

/** Cache-first for content-hashed build files. */
async function handleImmutableRequest(event) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const networkResponse = await fetch(event.request);
    if (networkResponse.status === 200) cacheInBackground(event, event.request, networkResponse);
    return networkResponse;
}

async function handleGenericGetRequest(event) {
    try {
        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200) {
            cacheInBackground(event, event.request, networkResponse);
        }
        return networkResponse;
    } catch {
        return (await caches.match(event.request)) || Response.error();
    }
}
// ── Web push (trail alert notifications) ────────────────────────────────────
// Payload is JSON {title, body, url} sent by push-seasonal-check / push-notices-check.

self.addEventListener('push', (event) => {
    let data = {title: 'CLDT Map', body: '', url: '/'};
    try {
        if (event.data) data = {...data, ...event.data.json()};
    } catch {
        // keep defaults on malformed payloads
    }
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            data: {url: data.url},
        }),
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(openNotificationTarget(event.notification.data && event.notification.data.url));
});

/** Opens a notification's link: same-origin links only (anything else opens the
 *  start page). An open app window is focused and navigated to it, which also
 *  reloads the alert data the page loaded once; otherwise a new window opens. */
async function openNotificationTarget(rawUrl) {
    let target = new URL('/', self.location.origin);
    try {
        const url = new URL(rawUrl || '/', self.location.origin);
        if (url.origin === self.location.origin) target = url;
    } catch {
        // malformed link: keep the start page
    }
    const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const existing = windows.find((client) => 'focus' in client);
    if (!existing) {
        await self.clients.openWindow(target.href);
        return;
    }
    let client = existing;
    try {
        client = await existing.focus();
    } catch {
        // could not bring it to the front; navigating it still shows the alert
    }
    try {
        await client.navigate(target.href);
    } catch {
        // A window this worker does not control cannot be navigated; it stays as it is.
    }
}
