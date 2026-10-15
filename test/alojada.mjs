#!/usr/bin/env node
/**
 * alojada.mjs — Laboratorio cargado desde la página de otro origen.
 *
 * Así es la app nativa que publica Floot: una página suya que enlaza la hoja de
 * estilos e importa js/app.js desde GitHub Pages. Aquí se reproduce con dos
 * servidores en puertos distintos (dos orígenes): uno sirve el repositorio con
 * CORS abierto, como GitHub Pages, y el otro sólo la página anfitriona.
 *
 * Lo que tiene que seguir funcionando: el arranque, la biblioteca (que guarda en
 * el origen de la anfitriona), y los descodificadores de HEIF y RAW, que corren
 * en workers y son lo que el navegador no deja crear desde otro origen.
 */
import pw from 'playwright';
const { chromium } = pw;
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const P_APP = 8098;
const P_HOST = 8099;
const APP = `http://localhost:${P_APP}/`;
const HOST = `http://127.0.0.1:${P_HOST}/`;
const HEIC = path.join(ROOT, 'test/muestras/muestra-iphone.heic');
const ARW = path.join(ROOT, 'test/capturas/muestra-sony-fx30.ARW');

let failures = 0;
const errors = [];
const check = (n, ok, d = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + n + (d ? '  ' + d : ''));
  if (!ok) failures++;
};

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json',
};

// El repositorio, con las cabeceras que pone GitHub Pages: CORS abierto.
const servApp = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, rel.endsWith('/') ? rel + 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('No encontrado');
    return;
  }
  res.writeHead(200, {
    'Content-Type': TIPOS[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  }).end(fs.readFileSync(file));
}).listen(P_APP);

// La anfitriona: lo mismo que hace la página de Floot (pages/_index.tsx).
const PAGINA = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Anfitriona</title></head>
<body><div id="raiz-react"></div>
<script type="module">
  const BASE = ${JSON.stringify(APP)};
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = BASE + 'styles/app.css';
  document.head.append(css);
  const app = document.createElement('div');
  app.id = 'app';
  document.getElementById('raiz-react').append(app);
  window.__base = BASE;
  window.__carga = import(BASE + 'js/app.js').then(() => 'ok', (e) => 'error: ' + e.message);
</script></body></html>`;
const servHost = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGINA);
}).listen(P_HOST);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(HOST, { waitUntil: 'networkidle' });

  console.log('\n── Arranque desde otro origen ──');
  const carga = await page.evaluate(() => window.__carga);
  check('js/app.js se importa desde el otro origen', carga === 'ok', carga);
  await page.waitForSelector('.tabbar__tab', { timeout: 15_000 }).catch(() => {});
  const arranque = await page.evaluate(async () => ({
    origen: location.origin,
    pestañas: document.querySelectorAll('.tabbar__tab').length,
    fondo: getComputedStyle(document.body).backgroundColor,
    cruzado: !!Worker.__cruzado,
    sw: (await navigator.serviceWorker?.getRegistrations?.() || []).length,
  }));
  check('la interfaz arranca con sus tres pestañas y su hoja de estilos', arranque.pestañas === 3 && arranque.fondo !== 'rgba(0, 0, 0, 0)',
    `${arranque.pestañas} pestañas, fondo ${arranque.fondo}`);
  check('los workers de otro origen quedan envueltos', arranque.cruzado);
  await page.waitForTimeout(800);
  const sw = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  check('no registra service worker en la página anfitriona', sw === 0, `${sw} registrados`);

  console.log('\n── HEIF: libheif en su worker ──');
  const heif = await page.evaluate(async () => {
    const { descodificarHeif } = await import(window.__base + 'js/store/heif.js');
    const blob = await (await fetch(window.__base + 'test/muestras/MUESTRA-SONY.HIF')).blob();
    const file = new File([blob], 'MUESTRA-SONY.HIF');
    try {
      const mini = await descodificarHeif(file, 300, { miniatura: true });
      const entera = await descodificarHeif(file, Infinity);
      const c = document.createElement('canvas'); c.width = entera.bitmap.width; c.height = entera.bitmap.height;
      const g = c.getContext('2d'); g.drawImage(entera.bitmap, 0, 0);
      const rojo = Array.from(g.getImageData(Math.floor(c.width * 0.25), Math.floor(c.height * 0.25), 1, 1).data.slice(0, 3));
      return { ok: true, mini: [mini.bitmap.width, mini.deMiniatura], entera: [entera.bitmap.width, entera.bitmap.height], rojo };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  check('un HIF de Sony se descodifica, miniatura y entera', heif.ok && heif.mini[1] === true && heif.entera[0] === 3000 && heif.entera[1] === 2000,
    heif.ok ? `mini ${heif.mini[0]} px, entera ${heif.entera.join('×')}` : heif.error);
  check('con sus colores', heif.ok && Math.abs(heif.rojo[0] - 200) <= 3 && Math.abs(heif.rojo[1] - 40) <= 3, heif.rojo?.join(','));

  console.log('\n── RAW: LibRaw en su worker de módulo ──');
  if (fs.existsSync(ARW)) {
    const raw = await page.evaluate(async () => {
      const { decodeRaw } = await import(window.__base + 'js/store/raw.js');
      const blob = await (await fetch(window.__base + 'test/capturas/muestra-sony-fx30.ARW')).blob();
      try {
        const r = await decodeRaw(new File([blob], 'muestra.ARW'), 800);
        return { ok: true, w: r.bitmap.width, h: r.bitmap.height, full: [r.sourceWidth, r.sourceHeight] };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    check('un ARW de Sony se revela', raw.ok && Math.max(raw.w, raw.h) === 800, raw.ok ? `${raw.w}×${raw.h} de ${raw.full.join('×')}` : raw.error);
  } else {
    console.log('  ⚠ sin muestra ARW en test/capturas: se omite (la descarga raw.mjs)');
  }

  console.log('\n── Biblioteca en el origen de la anfitriona ──');
  await page.locator('.tabbar__tab[data-tab="library"]').click();
  await page.locator('.lib__baractions .btn', { hasText: 'Importar' }).click();
  await page.locator('.imp input[type=file]:not([webkitdirectory])').setInputFiles([HEIC]);
  await page.waitForFunction(() => document.querySelectorAll('.imp__item').length === 1, null, { timeout: 30_000 }).catch(() => {});
  await page.locator('.imp__acciones .btn--primary').click();
  await page.waitForSelector('.imp', { state: 'hidden', timeout: 60_000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 1, null, { timeout: 30_000 }).catch(() => {});
  const lib = await page.evaluate(async () => {
    const { library } = await import(window.__base + 'js/store/library.js');
    const lista = await library.list();
    return { n: lista.length, w: lista[0]?.width, tiles: document.querySelectorAll('.tile').length };
  });
  check('una foto importada queda en la biblioteca', lib.n === 1 && lib.w === 2400 && lib.tiles === 1, JSON.stringify(lib));

  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => window.__carga);
  await page.locator('.tabbar__tab[data-tab="library"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 1, null, { timeout: 15_000 }).catch(() => {});
  const tras = await page.evaluate(() => document.querySelectorAll('.tile').length);
  check('y sigue ahí al volver a abrir la app', tras === 1, `${tras} fotos`);

  await page.locator('.tile').first().click();
  await page.locator('.viewer__action', { hasText: 'Laboratorio' }).click();
  await page.waitForFunction(() => !!window.__lab.views.lab.proxy && document.querySelector('.busy').hidden, null, { timeout: 60_000 }).catch(() => {});
  const lab = await page.evaluate(() => !!window.__lab.views.lab.proxy);
  check('se abre en el laboratorio', lab);

  const reales = errors.filter((e) => !/Failed to load resource.*favicon/i.test(e));
  check('sin errores en la consola', reales.length === 0, reales.slice(0, 4).join(' | '));
} finally {
  await browser.close();
  servApp.close();
  servHost.close();
}

console.log(failures ? `\n${failures} comprobaciones fallidas\n` : '\nTodo en orden\n');
process.exit(failures ? 1 : 0);
