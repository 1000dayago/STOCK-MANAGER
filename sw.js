/* 오프라인 지원: 앱 파일은 네트워크 우선(캐시 재검증), 실패 시 캐시 사용 */
importScripts('version.js');
const V = (self.SM_APP && self.SM_APP.version) || '0';
const CACHE = 'stockmgr-v' + V;
const FILES = ['./', 'index.html', 'style.css', 'version.js', 'icons.js', 'core.js', 'backtest.js', 'charts.js', 'media.js', 'editor.js', 'data.js', 'sync.js', 'ui.js', 'ui-link.js', 'ui-bt.js', 'ui-watch.js', 'ui-data.js', 'update.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];
const withV = (f) => (/\.(js|css)$/.test(f) ? f + '?v=' + V : f);
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(FILES.map((f) => c.add(new Request(withV(f), { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/version.json')) return; // 업데이트 확인은 항상 네트워크로
  e.respondWith(
    fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }))
      .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html', { ignoreSearch: true })))
  );
});
