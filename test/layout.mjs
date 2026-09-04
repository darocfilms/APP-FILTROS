#!/usr/bin/env node
/**
 * layout.mjs — La imagen manda.
 *
 * Esta suite existe porque el reparto de pantalla es fácil de romper sin
 * darse cuenta: basta un panel que crezca o un margen de más para que la
 * imagen encoja y nadie lo note hasta usarlo en un teléfono. Aquí se mide.
 */
import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOT = process.env.SHOT_DIR || ROOT + 'test/capturas';
const BASE = 'http://localhost:8086';

fs.mkdirSync(SHOT, { recursive: true });
const server = spawn('node', [path.join(ROOT, 'serve.mjs'), '--port=8086'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));

let failures = 0;
const errors = [];
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failures++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
         '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  permissions: ['camera', 'microphone'],
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

/** Tamaño de la imagen realmente PINTADA, no de la caja del elemento. */
const painted = (sel) => page.evaluate((s) => {
  const c = document.querySelector(s);
  if (!c || !c.width) return null;
  const r = c.getBoundingClientRect();
  const a = c.width / c.height;
  const boxA = r.width / r.height;
  const w = boxA > a ? r.height * a : r.width;
  const h = boxA > a ? r.height : r.width / a;
  return { w: Math.round(w), h: Math.round(h), vw: innerWidth, vh: innerHeight };
}, sel);

console.log('\n── Cámara: visor a pantalla completa, sensor entero ──');
const camState = await page.evaluate(() => {
  const v = window.__lab.views.camera;
  return { aspect: v.aspect, crop: v.params.geometry.crop, fit: getComputedStyle(document.querySelector('.cam__canvas')).objectFit };
});
check('el encuadre por defecto no recorta nada', camState.aspect === 'full'
  && camState.crop.w === 1 && camState.crop.h === 1, JSON.stringify(camState.crop));
check('el visor usa "contain": se ve el fotograma completo',
  camState.fit === 'contain', camState.fit);

const cam = await painted('.cam__canvas');
check('el visor ocupa todo el ancho de la pantalla',
  cam && cam.w >= cam.vw - 1, cam ? cam.w + '/' + cam.vw + ' px' : 'sin lienzo');

// El modo inmersivo debe liberar el alto que ocupan los mandos.
const boxBefore = await page.evaluate(() => document.querySelector('.cam__stage').getBoundingClientRect().height
  - parseFloat(getComputedStyle(document.querySelector('.cam__stage')).paddingTop)
  - parseFloat(getComputedStyle(document.querySelector('.cam__stage')).paddingBottom));
await page.locator('.cam__canvas').click({ position: { x: 195, y: 300 } });
await page.waitForTimeout(600);
const boxAfter = await page.evaluate(() => document.querySelector('.cam__stage').getBoundingClientRect().height
  - parseFloat(getComputedStyle(document.querySelector('.cam__stage')).paddingTop)
  - parseFloat(getComputedStyle(document.querySelector('.cam__stage')).paddingBottom));
check('tocar el visor oculta los mandos y libera la pantalla',
  boxAfter > boxBefore + 100, Math.round(boxBefore) + ' → ' + Math.round(boxAfter) + ' px de alto útil');
const chromeHidden = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.cam__bottom')).opacity === '0');
check('los mandos quedan realmente ocultos', chromeHidden);
await page.locator('.cam__stage').click({ position: { x: 195, y: 120 } });
await page.waitForTimeout(500);

// Cambiar de encuadre recorta, nunca vuelve a pedir el flujo.
await page.locator('.cam__aspect[data-aspect="1:1"]').click();
await page.waitForTimeout(600);
const square = await page.evaluate(() => {
  const v = window.__lab.views.camera;
  const c = document.querySelector('.cam__canvas');
  return { crop: v.params.geometry.crop, ratio: +(c.width / c.height).toFixed(3) };
});
check('el encuadre 1:1 recorta el fotograma, no pide otro',
  Math.abs(square.ratio - 1) < 0.02 && square.crop.w < 1, 'proporción ' + square.ratio);
await page.locator('.cam__aspect[data-aspect="full"]').click();
await page.waitForTimeout(500);
await page.screenshot({ path: SHOT + '/layout-camara.png' });

console.log('\n── Laboratorio: la imagen es lo más grande ──');
// Foto vertical, que es el caso real de un móvil.
const photo = SHOT + '/layout-vertical.jpg';
const dataUrl = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 3024; c.height = 4032;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 2400);
  sky.addColorStop(0, '#2c5f9e'); sky.addColorStop(1, '#cfe0ea');
  g.fillStyle = sky; g.fillRect(0, 0, 3024, 2400);
  g.fillStyle = '#3d5c3a'; g.fillRect(0, 2400, 3024, 1632);
  g.fillStyle = '#e0b89a'; g.beginPath(); g.arc(1200, 2500, 420, 0, 7); g.fill();
  return c.toDataURL('image/jpeg', 0.9);
});
fs.writeFileSync(photo, Buffer.from(dataUrl.split(',')[1], 'base64'));
await page.setInputFiles('input[type=file]', photo);
await page.waitForFunction(() => !!window.__lab?.views?.lab?.proxy, null, { timeout: 90_000 });
await page.waitForTimeout(1200);

const proxy = await page.evaluate(() => {
  const p = window.__lab.views.lab.proxy;
  return { w: p.width, h: p.height, dpr: devicePixelRatio, screen: Math.max(screen.width, screen.height) };
});
check('el proxy se adapta a la densidad de pantalla',
  proxy.w >= Math.min(2560, proxy.screen * proxy.dpr) * 0.7,
  proxy.w + '×' + proxy.h + ' con dpr ' + proxy.dpr);

const abierto = await painted('.lab__canvas');
check('con los ajustes abiertos la imagen ya ocupa la mayor parte del ancho',
  abierto.w >= abierto.vw * 0.8, abierto.w + '×' + abierto.h + ' (' + Math.round(abierto.w / abierto.vw * 100) + '% del ancho)');
check('la imagen es más alta que el panel de ajustes',
  abierto.h > await page.evaluate(() => document.querySelector('.panels').getBoundingClientRect().height),
  'imagen ' + abierto.h + ' px');

// Plegar debe AGRANDAR la imagen. Es la comprobación que atrapó el fallo de
// medir el hueco a mitad de la transición: entonces encogía.
await page.locator('.panels__grab').click();
await page.waitForTimeout(900);
const plegado = await painted('.lab__canvas');
check('plegar los ajustes agranda la imagen',
  plegado.w > abierto.w && plegado.h > abierto.h,
  abierto.w + '×' + abierto.h + ' → ' + plegado.w + '×' + plegado.h);
check('plegado, la imagen llena el ancho',
  plegado.w >= plegado.vw * 0.95, Math.round(plegado.w / plegado.vw * 100) + '%');
await page.screenshot({ path: SHOT + '/layout-lab-plegado.png' });

await page.locator('.panels__grab').click();
await page.waitForTimeout(900);
const vuelto = await painted('.lab__canvas');
check('desplegar devuelve el reparto anterior',
  Math.abs(vuelto.w - abierto.w) <= 2, vuelto.w + ' vs ' + abierto.w);

// Ningún panel puede desbordar horizontalmente.
console.log('\n── Ningún panel desborda su caja ──');
let overflow = 0;
for (const id of ['film', 'light', 'color', 'hsl', 'curves', 'grade', 'detail', 'effects', 'vignette', 'geometry']) {
  await page.locator(`.panelbar__tab[data-panel="${id}"]`).click();
  await page.waitForTimeout(260);
  const r = await page.evaluate(() => {
    const b = document.querySelector('.panelbody');
    return { body: b.scrollWidth - b.clientWidth, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  if (r.body > 1 || r.doc > 0) { overflow++; console.log('    ✗ ' + id + ' desborda ' + r.body + 'px'); }
}
check('los diez paneles contienen su contenido', overflow === 0);

console.log('\n── Errores de consola ──');
const real = errors.filter((e) => !/favicon|vibrate/i.test(e));
check('sin errores', real.length === 0, real.slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} fallo(s)\n` : '\nEl reparto de pantalla es correcto.\n');
await browser.close();
server.kill();
process.exit(failures ? 1 : 0);
