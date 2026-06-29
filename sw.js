// EasySatBox Fjelltur — service worker
// HTML hentes NETT-FØRST (alltid nyeste versjon), buffer brukes kun offline.
// Rører bare egne filer — Firebase, gstatic, kart-tiles og Netlify-funksjoner
// går urørt rett til nett. Firebase Auth-handleren (/__/...) hoppes ALLTID over.

const CACHE = 'esb-fjelltur-v4';            // bump (-v5, -v6 …) ved behov for å tømme gammel buffer
const CORE  = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {})));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Firebase Auth-handler (proxied til eget domene) — ALDRI buffer, alltid nett.
  if (url.pathname.startsWith('/__/')) return;

  // Kun egen origin. Alt eksternt (Firebase/gstatic/OSM/Netlify-funksjoner) → rett til nett.
  if (url.origin !== self.location.origin) return;

  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
