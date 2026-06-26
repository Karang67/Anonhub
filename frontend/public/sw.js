/**
 * AnonHub Service Worker (sw.js)
 * Cache-first strategy for app shell, network-first for API calls.
 * Enables offline access to the app shell and fast loads on mobile.
 */

const CACHE_NAME = 'anonhub-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install: cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for API/socket calls, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests and API/socket calls
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/socket.io/') ||
      url.pathname.startsWith('/upload') ||
      url.pathname.startsWith('/join-') ||
      url.pathname.startsWith('/create-')) {
    return; // Let these go to network directly
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Return cached, then update in background
        fetch(event.request).then((res) => {
          if (res && res.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res));
          }
        }).catch(() => {});
        return cached;
      }
      // Network fallback
      return fetch(event.request).then((res) => {
        if (res && res.ok && event.request.url.startsWith(self.location.origin)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      }).catch(() => {
        // If offline and it's a navigation, return the shell
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// Push notifications (Phase 4 hook)
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'AnonHub', body: 'New activity!' };
  event.waitUntil(
    self.registration.showNotification(data.title || 'AnonHub', {
      body: data.body || 'You have a new message.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'anonhub-notification',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});
