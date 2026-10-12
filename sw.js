importScripts('./precache.js');
const { revision, files } = self.PIXEL_PRECACHE;
const scope = new URL('./', self.location.href);
const prefix = 'pixel-studio-' + encodeURIComponent(scope.pathname) + '-';
const cacheName = prefix + revision;
const paths = new Set(files.map((file) => new URL(file, scope).pathname));

self.addEventListener('install', (event) =>
  event.waitUntil(
    caches.open(cacheName).then(async (cache) => {
      const results = await Promise.allSettled(
        files.map(async (file) => {
          const url = new URL(file, scope);
          url.searchParams.set('build', revision);
          const response = await fetch(url, { cache: 'reload' });
          if (!response.ok) throw Error('画室资源下载失败');
          await cache.put(new URL(file, scope), response);
        }),
      );
      if (results.some((result) => result.status === 'rejected')) {
        await caches.delete(cacheName);
        throw Error('画室资源下载不完整，请联网重试');
      }
    }),
  ),
);
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      // Cache names include the deployment scope; other apps on this origin are untouched.
      for (const name of await caches.keys()) {
        if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !paths.has(url.pathname))
    return;
  event.respondWith(
    caches.open(cacheName).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      return cached || fetch(event.request);
    }),
  );
});
