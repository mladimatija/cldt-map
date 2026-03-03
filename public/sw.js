// Service worker for caching map tiles
const CACHE_NAME = 'cldt-map-cache-v2';
const TILE_CACHE_NAME = 'cldt-map-tiles-v2';

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
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const urlsToCache = ['/', '/cldt-logo.svg'];
      return Promise.allSettled(
        urlsToCache.map((url) => cache.add(url).catch(() => {}))
      );
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => {
            return (
              cacheName.startsWith('cldt-map-') &&
              cacheName !== CACHE_NAME &&
              cacheName !== TILE_CACHE_NAME
            );
          })
          .map((cacheName) => {
            return caches.delete(cacheName);
          })
      );
    })
  );
});

// Fetch event - network first with cache fallback
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Handle tile requests differently (cache first)
  if (TILE_HOSTS.some(host => url.hostname.includes(host))) {
    event.respondWith(handleTileRequest(event.request));
    return;
  }
  
  // For other requests, use network-first strategy
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Cache the response if it's valid
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Fallback to cache if network fails
        return caches.match(event.request);
      })
  );
});

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