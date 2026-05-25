const CACHE_NAME = 'familypool-v2';
const STATIC_ASSETS = [
  '/',
  '/dashboard',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // 只處理同源請求，跳過 Supabase API
  if (url.origin !== self.location.origin) return;

  const isHTML = event.request.headers.get('Accept')?.includes('text/html');
  const isStatic = STATIC_ASSETS.includes(url.pathname);

  if (isHTML) {
    // === Network First（網路優先）===
    // 適用於頁面 HTML — 優先從網路載入最新版本
    // 離線時才使用快取
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else if (isStatic) {
    // === Cache First（快取優先）===
    // 適用於 manifest、icon 等靜態不變資源
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  } else {
    // === Network Only（僅網路）===
    // 其他所有請求（API、圖片等），直接從網路載入
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});
