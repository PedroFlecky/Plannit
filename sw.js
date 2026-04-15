/* ================================================
   PLANNIT — Service Worker
   Permite que o app funcione offline
   ================================================ */

const CACHE = 'plannit-v19';
const ASSETS = [
  '.',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/firebase.js',
  './js/firebase-init.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Instala e cacheia os arquivos do app
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Remove caches antigos ao ativar nova versão
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Responde com cache primeiro, depois rede como fallback
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
