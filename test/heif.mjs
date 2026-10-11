#!/usr/bin/env node
/**
 * heif.mjs — HEIF: los HEIC del iPhone y los HIF de las Sony.
 *
 * Chromium no sabe abrir ningún HEIF, así que esta suite ejercita la reserva:
 * libheif en su worker. Usa dos muestras pequeñas que van en el repositorio
 * (test/muestras), hechas con libheif + x265 con la misma estructura que las de
 * verdad, y un patrón de colores conocido —rojo, verde, azul y gris en cuatro
 * cuadrantes— para comprobar que los colores salen bien y en su sitio:
 *
 *   muestra-iphone.heic  2400×1800, 8 bits, 4:2:0, miniatura de 320 px
 *   MUESTRA-SONY.HIF     3000×2000, 10 bits, 4:2:2 (como una Sony), miniatura de 480 px
 */
import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8097;
const BASE = `http://localhost:${PORT}`;
const HEIC = path.join(ROOT, 'test/muestras/muestra-iphone.heic');
const HIF = path.join(ROOT, 'test/muestras/MUESTRA-SONY.HIF');

let failures = 0;
const errors = [];
const check = (n, ok, d = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + n + (d ? '  ' + d : ''));
  if (!ok) failures++;
};

const server = spawn('node', [path.join(ROOT, 'serve.mjs'), `--port=${PORT}`], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

// Colores del patrón (en sRGB de 8 bits) y dónde mirarlos, en fracción del ancho y el alto.
const CUADRANTES = [
  ['rojo', 0.25, 0.25, [200, 40, 40]],
  ['verde', 0.75, 0.25, [40, 180, 60]],
  ['azul', 0.25, 0.7, [40, 70, 200]],
  ['gris', 0.75, 0.7, [128, 128, 128]],
];
const cerca = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  console.log('\n── El navegador no los abre: los abre libheif ──');
  const nativo = await page.evaluate(async () => {
    const r = await fetch('/test/muestras/muestra-iphone.heic');
    try { await createImageBitmap(await r.blob()); return true; } catch { return false; }
  });
  check('Chromium no sabe abrir HEIF por su cuenta (lo que hace falta probar)', nativo === false);

  const directo = await page.evaluate(async () => {
    const { descodificarHeif } = await import('./js/store/heif.js');
    const out = {};
    for (const [nombre, url] of [['heic', '/test/muestras/muestra-iphone.heic'], ['hif', '/test/muestras/MUESTRA-SONY.HIF']]) {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], url.split('/').pop());
      let t = performance.now();
      const mini = await descodificarHeif(file, 300, { miniatura: true });
      const tMini = performance.now() - t;
      t = performance.now();
      const entera = await descodificarHeif(file, Infinity);
      const tEntera = performance.now() - t;
      // Colores de la entera, en los cuatro cuadrantes.
      const c = document.createElement('canvas'); c.width = entera.bitmap.width; c.height = entera.bitmap.height;
      const g = c.getContext('2d'); g.drawImage(entera.bitmap, 0, 0);
      const px = (fx, fy) => Array.from(g.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data.slice(0, 3));
      out[nombre] = {
        mini: [mini.bitmap.width, mini.bitmap.height, mini.deMiniatura, mini.sourceWidth, mini.sourceHeight, Math.round(tMini)],
        entera: [entera.bitmap.width, entera.bitmap.height, entera.deMiniatura, Math.round(tEntera)],
        colores: { rojo: px(0.25, 0.25), verde: px(0.75, 0.25), azul: px(0.25, 0.7), gris: px(0.75, 0.7) },
      };
    }
    return out;
  });
  for (const [n, d] of Object.entries(directo)) {
    const [w, h] = n === 'heic' ? [2400, 1800] : [3000, 2000];
    check(`${n.toUpperCase()}: la miniatura sale de la que lleva dentro, sin descodificar la foto entera`,
      d.mini[2] === true && Math.max(d.mini[0], d.mini[1]) === 300 && d.mini[3] === w && d.mini[4] === h,
      `${d.mini[0]}×${d.mini[1]} de ${d.mini[3]}×${d.mini[4]} en ${d.mini[5]} ms`);
    check(`${n.toUpperCase()}: la foto entera, a su tamaño`, d.entera[0] === w && d.entera[1] === h && d.entera[2] === false,
      `${d.entera[0]}×${d.entera[1]} en ${d.entera[3]} ms`);
    const malos = CUADRANTES.filter(([c, , , rgb]) => !cerca(d.colores[c], rgb, 3));
    check(`${n.toUpperCase()}: colores exactos y en su sitio${n === 'hif' ? ' (10 bits 4:2:2)' : ''}`, !malos.length,
      CUADRANTES.map(([c]) => `${c} ${d.colores[c].join(',')}`).join(' · '));
  }

  console.log('\n── Importar ──');
  await page.locator('.tabbar__tab[data-tab="library"]').click();
  await page.locator('.lib__baractions .btn', { hasText: 'Importar' }).click();
  await page.locator('.imp input[type=file]:not([webkitdirectory])').setInputFiles([HEIC, HIF]);
  await page.waitForFunction(() => [...document.querySelectorAll('.imp__mini img')].filter((i) => i.src).length === 2, null, { timeout: 30_000 }).catch(() => {});
  const menu = await page.evaluate(() => ({
    n: document.querySelectorAll('.imp__item').length,
    minis: [...document.querySelectorAll('.imp__mini img')].filter((i) => i.src && i.naturalWidth > 50).length,
    acepta: document.querySelector('.imp input[type=file]:not([webkitdirectory])').accept,
  }));
  check('el selector acepta .heic, .heif y .hif', /\.heic/.test(menu.acepta) && /\.heif/.test(menu.acepta) && /\.HIF/.test(menu.acepta), menu.acepta);
  check('los dos entran en el menú con su miniatura', menu.n === 2 && menu.minis === 2, `${menu.minis} de ${menu.n}`);
  await page.locator('.imp__acciones .btn--primary').click();
  await page.waitForSelector('.imp', { state: 'hidden', timeout: 60_000 });
  await page.waitForTimeout(600);
  const items = await page.evaluate(async () => {
    const { library } = await import('./js/store/library.js');
    const out = [];
    for (const i of await library.list()) out.push({ nombre: i.fuente?.nombre, w: i.width, h: i.height, mime: i.mime, thumb: !!(await library.getThumbBlob(i.id)) });
    return out;
  });
  const hif = items.find((i) => i.nombre === 'MUESTRA-SONY.HIF');
  const heic = items.find((i) => i.nombre === 'muestra-iphone.heic');
  check('en la biblioteca, con su tamaño y su miniatura', hif?.w === 3000 && hif?.h === 2000 && heic?.w === 2400 && hif.thumb && heic.thumb,
    JSON.stringify(items));
  check('un .HIF sin tipo queda guardado como image/heif', hif?.mime === 'image/heif' || hif?.mime === 'image/heic', hif?.mime);

  console.log('\n── Visor, laboratorio y exportación ──');
  for (const [nombre, w, h, titulo] of [['MUESTRA-SONY.HIF', 3000, 2000, 'HIF'], ['muestra-iphone.heic', 2400, 1800, 'HEIF']]) {
    const i = await page.evaluate(async (n) => {
      const { library } = await import('./js/store/library.js');
      const lista = await library.list();
      return lista.findIndex((x) => x.fuente?.nombre === n);
    }, nombre);
    await page.locator('.tile').nth(i).click();
    await page.waitForFunction(() => document.querySelector('.viewer__media')?.naturalWidth > 0, null, { timeout: 30_000 }).catch(() => {});
    const visor = await page.evaluate(() => document.querySelector('.viewer__media')?.naturalWidth || 0);
    check(`${titulo}: el visor lo enseña (Chromium no podría con el original en un <img>)`, visor > 500, `${visor} px`);
    await page.locator('.viewer__action', { hasText: 'Laboratorio' }).click();
    await page.waitForFunction(() => !!window.__lab.views.lab.proxy && document.querySelector('.busy').hidden, null, { timeout: 60_000 });
    await page.waitForTimeout(500);
    const lab = await page.evaluate((cuads) => {
      const v = window.__lab.views.lab;
      const c = document.createElement('canvas'); c.width = v.canvas.width; c.height = v.canvas.height;
      const g = c.getContext('2d'); g.drawImage(v.canvas, 0, 0);
      const px = (fx, fy) => Array.from(g.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data.slice(0, 3));
      return { titulo: v.title.textContent, src: [v.sourceWidth, v.sourceHeight], colores: Object.fromEntries(cuads.map(([n, fx, fy]) => [n, px(fx, fy)])) };
    }, CUADRANTES);
    check(`${titulo}: el laboratorio lo abre y lo dice`, lab.titulo === titulo && lab.src[0] === w && lab.src[1] === h, `${lab.titulo} · ${lab.src.join('×')}`);
    // Revelado neutro con el tramado de la app (±1): los colores siguen siendo los del archivo.
    const malos = CUADRANTES.filter(([n, , , rgb]) => !cerca(lab.colores[n], rgb, 4));
    check(`${titulo}: revelado en neutro, mismos colores`, !malos.length, CUADRANTES.map(([n]) => `${n} ${lab.colores[n].join(',')}`).join(' · '));
    await page.locator('.tabbar__tab[data-tab="library"]').click();
    await page.waitForTimeout(400);
  }

  // Exportar a tamaño original, con un ajuste: el original se descodifica entero.
  const exportado = await page.evaluate(async () => {
    const { library } = await import('./js/store/library.js');
    const { develop } = await import('./js/store/develop.js');
    const it = (await library.list()).find((x) => x.fuente?.nombre === 'MUESTRA-SONY.HIF');
    const file = await library.getFile(it.id);
    const { blob, width, height } = await develop(file, { light: { exposure: 0.5 } }, Infinity);
    return { width, height, tipo: blob.type, tam: blob.size };
  });
  check('exportar un HIF con ajustes sale a 3000×2000 en JPEG', exportado.width === 3000 && exportado.height === 2000 && exportado.tipo === 'image/jpeg',
    `${exportado.width}×${exportado.height} ${exportado.tipo}`);
  await ctx.close();

  console.log('\n── Una sola foto, directa ──');
  const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const p2 = await movil.newPage();
  p2.on('pageerror', (e) => errors.push('pageerror (móvil): ' + e.message));
  await p2.goto(BASE, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1000);
  await p2.setInputFiles('input[type=file]', HIF);
  await p2.waitForFunction(() => !!window.__lab?.views?.lab?.proxy && document.querySelector('.busy').hidden, null, { timeout: 60_000 }).catch(() => {});
  check('elegir un .HIF solo lo importa y lo abre en el laboratorio',
    await p2.evaluate(() => window.__lab.current === 'lab' && window.__lab.views.lab.sourceWidth === 3000));
  await movil.close();
} catch (err) {
  console.error(err);
  failures++;
}

const reales = errors.filter((e) => !/Failed to load resource/.test(e));
check('sin errores en la consola', reales.length === 0, reales.slice(0, 3).join(' | '));

await browser.close();
server.kill();
console.log(failures ? `\n${failures} fallo(s)\n` : '\nTodo correcto\n');
process.exit(failures ? 1 : 0);
