// Service worker for CLDT Map (app shell + tiles)
const CACHE_NAME = 'cldt-map-cache-v3';
const TILE_CACHE_NAME = 'cldt-map-tiles-v3';
const OFFLINE_URL = '/offline';
const CORE_ASSETS = ['/', OFFLINE_URL, '/manifest.webmanifest', '/cldt-logo.svg', '/icon-192.png', '/icon-512.png'];

// Tile hosts to cache for offline map use
const TILE_HOSTS = [
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
  'tile.opentopomap.org',
  'a.tile.opentopomap.org',
  'b.tile.opentopomap.org',
  'c.tile.opentopomap.org',
  'server.arcgisonline.com',
  'tile-cyclosm.openstreetmap.fr',
  'a.tile-cyclosm.openstreetmap.fr',
  'b.tile-cyclosm.openstreetmap.fr',
  'c.tile-cyclosm.openstreetmap.fr',
];

// Install event - cache core assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url).catch(() => {})));
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => {
            return cacheName.startsWith('cldt-map-') && cacheName !== CACHE_NAME && cacheName !== TILE_CACHE_NAME;
          })
          .map((cacheName) => caches.delete(cacheName))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch event - network first with cache fallback
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') {
    return;
  }

  const url = new URL(req.url);

  // Handle tile requests differently (cache first)
  if (TILE_HOSTS.some((host) => url.hostname.includes(host))) {
    event.respondWith(handleTileRequest(req));
    return;
  }

  // Navigation requests: network first, then offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(req));
    return;
  }

  // For other GET requests, prefer network but fall back to cache.
  event.respondWith(handleGenericGetRequest(req));
});

async function handleNavigationRequest(request) {
  try {
    const networkResponse = await fetch(request);
    // Cache successful navigations for faster repeat loads.
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('Offline', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function handleGenericGetRequest(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const responseClone = networkResponse.clone();
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, responseClone);
    }
    return networkResponse;
  } catch {
    return caches.match(request);
  }
}

// Special handler for tile requests
async function handleTileRequest(request) {
  const cache = await caches.open(TILE_CACHE_NAME);
  const cachedResponse = await cache.match(request.url || request);
  
  if (cachedResponse) {
    // Return cached tile
    return cachedResponse;
  }
  
  try {
    // Get from network and cache
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // If both cache and network fail, return a placeholder tile (gray 256x256 SVG)
    console.error('Failed to fetch tile:', error);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">' +
      '<rect width="256" height="256" fill="#e5e7eb"/>' +
      '<text x="128" y="136" font-family="sans-serif" font-size="14" fill="#6b7280" text-anchor="middle">Offline</text>' +
      '</svg>';
    return new Response(svg, {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' },
    });
  }
}