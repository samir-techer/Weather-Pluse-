/* ============================================
   Weather Pluse+ - Service Worker
   ============================================ */

const CACHE_NAME = 'weather-pulse-v2';
const STATIC_CACHE = 'weather-pulse-static-v2';
const DYNAMIC_CACHE = 'weather-pulse-dynamic-v2';
const IMAGE_CACHE = 'weather-pulse-images-v2';

// Static assets to cache
const STATIC_ASSETS = [
  '/WeatherPulse/',
  '/WeatherPulse/index.html',
  '/WeatherPulse/offline.html',
  '/WeatherPulse/manifest.json',
  '/WeatherPulse/assets/css/style.css',
  '/WeatherPulse/assets/js/script.js',
  '/WeatherPulse/assets/js/firebase-config.js',
  '/WeatherPulse/assets/icons/favicon.ico',
  '/WeatherPulse/assets/icons/favicon-32.png',
  '/WeatherPulse/assets/icons/favicon-16.png',
  '/WeatherPulse/assets/icons/apple-touch-icon.png',
  '/WeatherPulse/assets/icons/icon-72.png',
  '/WeatherPulse/assets/icons/icon-96.png',
  '/WeatherPulse/assets/icons/icon-128.png',
  '/WeatherPulse/assets/icons/icon-144.png',
  '/WeatherPulse/assets/icons/icon-152.png',
  '/WeatherPulse/assets/icons/icon-192.png',
  '/WeatherPulse/assets/icons/icon-384.png',
  '/WeatherPulse/assets/icons/icon-512.png',
  '/WeatherPulse/assets/icons/maskable-512.png',
  '/WeatherPulse/assets/icons/notification.png'
];

// External assets to cache
const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        return caches.open(STATIC_CACHE);
      })
      .then(cache => {
        // Try to cache external assets (may fail due to CORS)
        return Promise.allSettled(
          EXTERNAL_ASSETS.map(url => 
            fetch(url, { mode: 'no-cors' })
              .then(response => cache.put(url, response))
              .catch(err => console.log('[SW] Failed to cache external:', url))
          )
        );
      })
      .then(() => {
        console.log('[SW] Install complete');
        return self.skipWaiting();
      })
      .catch(err => console.error('[SW] Install failed:', err))
  );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');

  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (
              cacheName !== STATIC_CACHE &&
              cacheName !== DYNAMIC_CACHE &&
              cacheName !== IMAGE_CACHE
            ) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Activation complete');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip Firebase and analytics
  if (url.hostname.includes('firebase') || url.hostname.includes('google-analytics')) {
    return;
  }

  // Strategy for API calls - network first, cache fallback
  if (url.hostname.includes('openweathermap.org')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Strategy for images - cache first, network fallback
  if (request.destination === 'image') {
    event.respondWith(imageCache(request));
    return;
  }

  // Strategy for static assets - cache first
  if (
    url.pathname.startsWith('/WeatherPulse/assets/') ||
    url.pathname === '/WeatherPulse/' ||
    url.pathname === '/WeatherPulse/index.html' ||
    url.pathname === '/WeatherPulse/offline.html' ||
    url.pathname === '/WeatherPulse/manifest.json'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Default - stale while revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// Cache strategies
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Return offline page for HTML requests
    if (request.headers.get('accept')?.includes('text/html')) {
      return cache.match('/WeatherPulse/offline.html');
    }
    throw error;
  }
}

async function networkFirst(request) {
  const cache = await caches.open(DYNAMIC_CACHE);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

async function imageCache(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    // Revalidate in background
    fetch(request)
      .then(response => {
        if (response.ok) {
          cache.put(request, response);
        }
      })
      .catch(() => {});
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Return a placeholder or empty response
    return new Response('', { status: 404, statusText: 'Not found' });
  }
}

// Background sync for weather updates
self.addEventListener('sync', (event) => {
  if (event.tag === 'weather-sync') {
    event.waitUntil(syncWeather());
  }
});

async function syncWeather() {
  // This would sync weather data when back online
  console.log('[SW] Syncing weather data...');
}

// Push notifications
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};

  const options = {
    body: data.body || 'Weather update available',
    icon: '/WeatherPulse/assets/icons/notification.png',
    image: '/WeatherPulse/assets/icons/icon-192.png',
    badge: '/WeatherPulse/assets/icons/icon-72.png',
    tag: data.tag || 'weather-alert',
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [
      { action: 'open', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    data: data.data || {}
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || 'Weather Pluse+ Alert',
      options
    )
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action;
  const notificationData = event.notification.data;

  if (action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        const url = notificationData.url || '/WeatherPulse/index.html';

        // Focus existing client
        for (const client of clientList) {
          if (client.url.includes('WeatherPulse') && 'focus' in client) {
            client.focus();
            client.navigate(url);
            return;
          }
        }

        // Open new window
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// Message handler from main thread
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});