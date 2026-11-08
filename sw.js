// 오프라인에서도 앱 화면이 열리게 해 주는 파일이에요.
// 인터넷이 되면 항상 새 파일을 먼저 받고, 안 될 때만 저장해 둔 파일을 보여줘요.
const CACHE = 'today-world-v2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'countries.js', 'worldmap.svg', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html')))
  );
});
