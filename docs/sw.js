/* 샤먼 여행 페이지 오프라인 저장.
   - 페이지(index.html): 인터넷 먼저 시도, 4초 안에 안 오면 저장본을 보여줌 (중국 와이파이 대비)
   - 지도 라이브러리, 아이콘, 음식 사진: 저장본 먼저
   - 음식 사진 목록은 index.html에서 img/ 경로를 찾아 자동으로 저장하므로, 사진을 추가해도 이 파일을 고칠 필요 없음
   - 지도 타일은 저장하지 않음 (용량이 커서). 지도와 길찾기는 인터넷 필요 */
const CACHE = 'xiamen-v1';
const FONT_CACHE = 'xiamen-fonts-v1';
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png',
];

async function cacheImagesFrom(html) {
  const cache = await caches.open(CACHE);
  const paths = [...new Set(html.match(/img\/[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|webp)/g) || [])];
  await Promise.all(paths.map(async p => {
    if (await cache.match(p)) return;
    try { const r = await fetch(p); if (r.ok) await cache.put(p, r); } catch (e) {}
  }));
}

async function notifyCached() {
  const list = await self.clients.matchAll({ includeUncontrolled: true });
  list.forEach(c => c.postMessage('cached'));
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    const page = await cache.match('index.html');
    if (page) await cacheImagesFrom(await page.text());
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [CACHE, FONT_CACHE];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
    await notifyCached();
  })());
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

async function pageFirstNetwork(req, ev) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req), timeout(4000)]);
    if (res.ok) {
      const copy = res.clone();
      ev.waitUntil((async () => {
        const text = await copy.clone().text();
        await cache.put('index.html', copy);
        await cacheImagesFrom(text);
      })());
    }
    return res;
  } catch (e) {
    return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: cacheName === CACHE });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
    e.respondWith(isPage ? pageFirstNetwork(req, e) : cacheFirst(req, CACHE));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, FONT_CACHE).catch(() => new Response('', { status: 504 })));
  }
  /* 그 밖의 외부 요청(지도 타일, 검색 링크 등)은 건드리지 않음 */
});
