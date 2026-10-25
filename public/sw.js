// 서비스워커: 최신 화면을 우선 보여주고(network-first), 오프라인일 때만 저장된 화면을 사용합니다.
const CACHE = 'tour-nearby-v2';
const SHELL = [
  '/',
  '/styles.css',
  '/js/app.js',
  '/js/api.js',
  '/js/detail.js',
  '/js/location.js',
  '/js/map.js',
  '/js/monthly.js',
  '/js/nearby.js',
  '/js/state.js',
  '/js/staticEngine.js',
  '/js/util.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('/');
        return new Response(JSON.stringify({ error: '오프라인 상태예요.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }),
  );
});
