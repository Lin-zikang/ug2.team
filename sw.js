const CACHE_NAME = 'ug2-content-center-v15-logo-only-20260919';
const MAX_AGE = 24 * 60 * 60 * 1000;
const CORE_ASSETS = [
  './community.html?v=20260919-r5',
  './assets/community.css?v=20260919-r6',
  './assets/community.js?v=20260919-r5',
  './assets/library-loader.js?v=20260919-r3',
  './logo.svg',
  './vendor/marked.min.js',
  './vendor/purify.min.js',
  './vendor/katex.min.js',
  './vendor/katex.min.css',
  './vendor/fonts/KaTeX_AMS-Regular.woff2',
  './vendor/fonts/KaTeX_Caligraphic-Bold.woff2',
  './vendor/fonts/KaTeX_Caligraphic-Regular.woff2',
  './vendor/fonts/KaTeX_Fraktur-Bold.woff2',
  './vendor/fonts/KaTeX_Fraktur-Regular.woff2',
  './vendor/fonts/KaTeX_Main-Bold.woff2',
  './vendor/fonts/KaTeX_Main-BoldItalic.woff2',
  './vendor/fonts/KaTeX_Main-Italic.woff2',
  './vendor/fonts/KaTeX_Main-Regular.woff2',
  './vendor/fonts/KaTeX_Math-BoldItalic.woff2',
  './vendor/fonts/KaTeX_Math-Italic.woff2',
  './vendor/fonts/KaTeX_SansSerif-Bold.woff2',
  './vendor/fonts/KaTeX_SansSerif-Italic.woff2',
  './vendor/fonts/KaTeX_SansSerif-Regular.woff2',
  './vendor/fonts/KaTeX_Script-Regular.woff2',
  './vendor/fonts/KaTeX_Size1-Regular.woff2',
  './vendor/fonts/KaTeX_Size2-Regular.woff2',
  './vendor/fonts/KaTeX_Size3-Regular.woff2',
  './vendor/fonts/KaTeX_Size4-Regular.woff2',
  './vendor/fonts/KaTeX_Typewriter-Regular.woff2'
];

function metaRequest(url) {
  return new Request(`${self.location.origin}/__ug2_cache_meta__?url=${encodeURIComponent(url)}`);
}

async function readTimestamp(cache, url) {
  const hit = await cache.match(metaRequest(url));
  if (!hit) return 0;
  const value = Number(await hit.text());
  return Number.isFinite(value) ? value : 0;
}

async function writeTimestamp(cache, url) {
  await cache.put(metaRequest(url), new Response(String(Date.now()), { headers: { 'content-type': 'text/plain' } }));
}

async function fetchAndCache(request) {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    await cache.put(request, response.clone());
    await writeTimestamp(cache, request.url);
  }
  return response;
}

async function cacheWithMaxAge(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const timestamp = await readTimestamp(cache, request.url);
  const fresh = cached && timestamp && Date.now() - timestamp < MAX_AGE;
  if (fresh) return cached;
  if (cached) {
    await cache.delete(request);
    await cache.delete(metaRequest(request.url));
  }
  try {
    return await fetchAndCache(request);
  } catch (error) {
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(CORE_ASSETS.map(async (url) => {
      try {
        const request = new Request(url, { cache: 'reload' });
        const response = await fetch(request);
        if (response.ok) {
          await cache.put(request, response.clone());
          await writeTimestamp(cache, new URL(url, self.location.href).href);
        }
      } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('ug2-content-center-') && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const isOfficialContent = url.origin === self.location.origin && url.pathname.includes('/content/');
  if (isOfficialContent) {
    event.respondWith(fetch(new Request(request, { cache: 'no-store' })));
    return;
  }

  const isLibrary = ['cdn.bootcdn.net', 'cdn.staticfile.net', 's4.zstatic.net', 'cdnjs.snrat.com'].includes(url.hostname);
  const isLocalAsset = url.origin === self.location.origin && (
    url.pathname.includes('/vendor/') ||
    url.pathname.includes('/assets/') ||
    url.pathname.endsWith('/community.html') ||
    url.pathname.endsWith('/logo.svg')
  );
  if (isLibrary || isLocalAsset) {
    event.respondWith(cacheWithMaxAge(request));
  }
});
