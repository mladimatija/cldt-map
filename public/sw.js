// Service worker for CLDT Map (app shell + tiles)
const CACHE_VERSION = 4;
const CACHE_NAME = `cldt-map-cache-v${CACHE_VERSION}`;
const OFFLINE_URL = '/offline';
const TILE_CACHE_PREFIX = 'cldt-tiles-';

const CORE_ASSETS = ['/', OFFLINE_URL, '/manifest.webmanifest', '/cldt-logo.svg', '/icon-192.png', '/icon-512.png'];

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
        if (networkResponse.ok || networkResponse.type === 'opaque') {
            try {
                await cache.put(request, networkResponse.clone());
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