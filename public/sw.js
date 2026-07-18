const CACHE = 'peacemindset-v3';
const STATIC = ['/','manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC).catch(()=>{})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (url.includes('/api/')) return;
  if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic') || url.includes('unpkg.com') || url.includes('cdn.socket.io')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(r => {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return r;
        });
      })
    );
    return;
  }
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && e.request.url.includes(self.location.origin)) {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});

self.addEventListener('push', e => {
  const data = e.data?.json() || {title:'Peace Mindset',body:'New update!'};
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: '/favicon.ico', badge: '/favicon.ico', vibrate: [200,100,200]
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
