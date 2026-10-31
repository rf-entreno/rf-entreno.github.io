'use strict';
// Service worker de RODRIGO FIT: guarda la aplicación para usarla sin conexión. No guarda datos personales (esos están en localStorage).
const CACHE = 'rodrigo-fit-1145d039fbdb';
const FILES = ["./","./index.html","./style.css","./app.js","./config.js","./routine.js","./manifest.webmanifest","./media/pendiente.svg","./media/pendiente-mini.svg","./media.js","./icons/icon-180.png","./icons/icon-192.png","./icons/icon-512.png"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('rodrigo-fit-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (e.request.mode === 'navigate') { e.respondWith(caches.match('./index.html').then(r => r || fetch(e.request))); return; }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
