import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkFirst, NetworkOnly, Serwist, ExpirationPlugin } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const API_CACHE = 'trigon-api';

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Never cache auth or the realtime handshake.
    { matcher: ({ url }) => url.pathname.startsWith('/api/auth'), handler: new NetworkOnly() },
    // Navigation data (spaces, trees, recent docs, page metadata, file bytes) works offline,
    // falling back to the last good response when the network is slow or gone.
    {
      matcher: ({ url, request, sameOrigin }) => sameOrigin && request.method === 'GET' && url.pathname.startsWith('/api/'),
      handler: new NetworkFirst({
        cacheName: API_CACHE,
        networkTimeoutSeconds: 4,
        plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 7 * 24 * 3600 })],
      }),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [{ url: '/~offline', matcher: ({ request }) => request.destination === 'document' }],
  },
});

// The app posts this on sign-out so cached private data doesn't outlive the session.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_PRIVATE_CACHE') event.waitUntil(caches.delete(API_CACHE));
});

serwist.addEventListeners();
