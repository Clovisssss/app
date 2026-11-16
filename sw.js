// Service worker : met l'application en cache pour qu'elle fonctionne hors ligne.
// Incrémentez CACHE_VERSION à chaque modification des fichiers pour forcer la mise à jour.
const CACHE_VERSION = 'v2';
const CACHE_NAME = `undercover-${CACHE_VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './words.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stratégie « stale-while-revalidate » : réponse instantanée depuis le cache,
// et mise à jour en arrière-plan pour la prochaine ouverture.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(req).then(cached => {
        const network = fetch(req)
          .then(res => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
