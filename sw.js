/**
 * sw.js — Service worker.
 *
 * El armazón se precachea para que la aplicación arranque sin red (importante:
 * en la pantalla de inicio del iPhone se abre a menudo sin cobertura). Los
 * archivos del usuario NO pasan por aquí: viven en OPFS e IndexedDB, que es
 * almacenamiento real y no una caché que el navegador pueda desalojar.
 */

const VERSION = 'lab-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/app.css',
  './icons/icon.svg',
  './js/app.js',
  './js/data/films.js',
  './js/data/params.js',
  './js/engine/colorscience.js',
  './js/engine/glcore.js',
  './js/engine/renderer.js',
  './js/engine/shaders.js',
  './js/store/library.js',
  './js/ui/controls.js',
  './js/ui/crop.js',
  './js/ui/curve.js',
  './js/ui/filmpicker.js',
  './js/ui/histogram.js',
  './js/ui/panels.js',
  './js/ui/wheel.js',
  './js/utils/dom.js',
  './js/utils/share.js',
  './js/views/camera.js',
  './js/views/lab.js',
  './js/views/library.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // addAll falla en bloque si un solo recurso falla; se piden de una en una
    // para que un archivo perdido no deje la aplicación sin instalar.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Red primero con reserva en caché: así una recarga trae siempre la última
  // versión cuando hay conexión, y sigue funcionando cuando no la hay.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const cache = await caches.open(VERSION);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Sin conexión', { status: 503, statusText: 'Sin conexión' });
    }
  })());
});
