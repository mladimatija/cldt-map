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
];

// Tile hosts to cache - keyed by substring match
const TILE_HOSTS = [
    'tile.openstreetmap.org',
    'tile.opentopomap.org',
    'server.arcgisonline.com',
    'tile-cyclosm.openstreetmap.fr',
    'basemaps.cartocdn.com',
    'geoportal.dgu.hr',
];

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
    if (isAllowedHost(hostname, 'cartocdn.com')) return 'carto';
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
const CROATIA_BBOX = { latMin: 42.3, latMax: 46.56, lngMin: 13.2, lngMax: 19.45 };
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
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url).catch(() => {
            })));
        }),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const cacheNames = await caches.keys();
            // Remove old versioned app-shell caches and old monolithic tile caches
            await Promise.all(
                cacheNames
                    .filter((name) => {
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

    // Tile requests: cache-first with per-provider caching
    if (isTileRequest(url)) {
        event.respondWith(handleTileRequest(req, url));
        return;
    }

    // Navigation requests: network-first, offline fallback
    if (req.mode === 'navigate') {
        event.respondWith(handleNavigationRequest(req));
        return;
    }

    // Other GET requests: network-first, cache fallback
    event.respondWith(handleGenericGetRequest(req));
});

// ── Request handlers ─────────────────────────────────────────────────────────

async function handleTileRequest(request, url) {
    const cacheName = getTileCacheName(url.hostname);
    const cache = await caches.open(cacheName);

    const cachedResponse = await cache.match(request.url || request);
    if (cachedResponse) return cachedResponse;

    try {
        const networkResponse = await fetch(request);
        const inBounds = await tileShouldBeCached(url, getTileProviderKey(url.hostname));
        if (inBounds && (networkResponse.ok || networkResponse.type === 'opaque')) {
            try {
                await cache.put(request, networkResponse.clone());
                if (Math.random() < TILE_TRIM_SAMPLE_RATE) {
                    // Out-of-band: don't delay the tile response on housekeeping.
                    trimTileCache(cache);
                }
            } catch (cacheErr) {
                // Storage quota exceeded or other cache write error - serve the tile anyway
                if (cacheErr && cacheErr.name === 'QuotaExceededError') {
                    // Notify all clients so the UI can surface a warning
                    const clients = await self.clients.matchAll({type: 'window'});
                    clients.forEach((client) => client.postMessage({type: 'TILE_QUOTA_EXCEEDED'}));
                }
            }
        }
        return networkResponse;
    } catch {
        // Network failed - return offline placeholder tile
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

async function handleNavigationRequest(request) {
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;
        const offline = await cache.match(OFFLINE_URL);
        if (offline) return offline;
        return new Response('Offline', {status: 200, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
    }
}

async function handleGenericGetRequest(request) {
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch {
        return caches.match(request);
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
    const url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        self.clients.matchAll({type: 'window', includeUncontrolled: true}).then((clients) => {
            for (const client of clients) {
                if ('focus' in client) return client.focus();
            }
            return self.clients.openWindow(url);
        }),
    );
});
