const VERSION = 'pm-v4';
const SHELL = 'shell-' + VERSION;
const LIBS = 'libs-' + VERSION;
const PRECACHE = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];
const CDN = ['fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com', 'cdn.socket.io', 'cdnjs.cloudflare.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(PRECACHE.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== LIBS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Pages: network first, so every launch gets the newest deploy. Cache is only an offline / slow-network fallback.
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  const net = fetch(req).then(res => { if (res && res.ok) cache.put('/', res.clone()); return res; });
  const cached = await cache.match('/');
  if (!cached) return net;
  return Promise.race([net, new Promise(r => setTimeout(() => r(cached), 6000))]).catch(() => cached);
}

async function swr(name, req) {
  const cache = await caches.open(name);
  const cached = await cache.match(req);
  const net = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await net) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin === self.location.origin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/'))) return;
  if (CDN.includes(url.hostname)) { e.respondWith(swr(LIBS, req)); return; }
  if (url.origin !== self.location.origin) return; // backend and other sites: never touched
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req)); return; }
  e.respondWith(swr(SHELL, req));
});

self.addEventListener('push', e => {
  let data = { title: 'Peace Mindset', body: 'New update!' };
  try { data = e.data ? e.data.json() : data; } catch (err) {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', vibrate: [200, 100, 200]
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
