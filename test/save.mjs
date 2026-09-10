#!/usr/bin/env node
/**
 * save.mjs — Guardar fuera de la aplicación, y selección múltiple.
 *
 * Guardar en iPhone falla de formas silenciosas: `navigator.share` exige
 * activación del usuario y esa activación CADUCA, así que revelar una foto de
 * doce megapíxeles entre el toque y la llamada la invalida. Y el atributo
 * `download` de un enlace, que sería la reserva evidente, Safari lo ignora
 * cuando el destino es un blob. Esta suite fija las dos cosas.
 */
import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOT = process.env.SHOT_DIR || ROOT + 'test/capturas';
const BASE = 'http://localhost:8084';

fs.mkdirSync(SHOT, { recursive: true });
const server = spawn('node', [path.join(ROOT, 'serve.mjs'), '--port=8084'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));

let failures = 0;
const errors = [];
const check = (n, ok, d = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + n + (d ? '  ' + d : ''));
  if (!ok) failures++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
         '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ['camera', 'microphone'],
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

/* Se simula la hoja de compartir y se registra CUÁNDO se llama, para poder
   comprobar que ocurre dentro del gesto y no después de trabajo asíncrono. */
await page.addInitScript(() => {
  window.__shareLog = [];
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => {
    window.__shareLog.push({
      archivos: d.files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      activo: navigator.userActivation ? navigator.userActivation.isActive : null,
    });
  };
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

console.log('\n── Importar tres archivos ──');
const files = [];
for (let i = 0; i < 3; i++) {
  const p = SHOT + `/save-${i}.jpg`;
  const dataUrl = await page.evaluate((n) => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
    const g = c.getContext('2d');
    g.fillStyle = ['#2c5f9e', '#9e5f2c', '#2c9e5f'][n];
    g.fillRect(0, 0, 900, 1200);
    g.fillStyle = '#fff'; g.font = 'bold 300px sans-serif';
    g.fillText(String(n + 1), 340, 750);
    return c.toDataURL('image/jpeg', 0.9);
  }, i);
  fs.writeFileSync(p, Buffer.from(dataUrl.split(',')[1], 'base64'));
  files.push(p);
}
await page.setInputFiles('input[type=file]', files);
await page.waitForTimeout(4500);
await page.locator('.tabbar__tab[data-tab="library"]').click();
await page.waitForTimeout(1500);
check('los tres archivos están en la biblioteca',
  await page.locator('.tile').count() === 3, (await page.locator('.tile').count()) + ' miniaturas');

console.log('\n── Selección múltiple ──');
await page.locator('.lib__baractions .btn', { hasText: 'Seleccionar' }).click();
await page.waitForTimeout(400);
check('la barra de selección aparece', await page.locator('.selbar:not([hidden])').count() === 1);
check('las acciones empiezan desactivadas',
  await page.locator('.selbar__actions .btn[disabled]').count() === 2);

const tiles = page.locator('.tile');
await tiles.nth(0).click();
await tiles.nth(2).click();
await page.waitForTimeout(400);
check('se marcan los elegidos', await page.locator('.tile.is-selected').count() === 2);
check('el contador refleja la selección',
  (await page.locator('.selbar__count').textContent()).includes('2'),
  await page.locator('.selbar__count').textContent());
check('las acciones se habilitan',
  await page.locator('.selbar__actions .btn[disabled]').count() === 0);
await page.screenshot({ path: SHOT + '/save-seleccion.png' });

await page.locator('.linkbtn', { hasText: 'Todo' }).click();
await page.waitForTimeout(400);
check('«Todo» selecciona los tres', await page.locator('.tile.is-selected').count() === 3);
await page.locator('.linkbtn', { hasText: 'Ninguno' }).click();
await page.waitForTimeout(300);
check('«Ninguno» limpia la selección', await page.locator('.tile.is-selected').count() === 0);

console.log('\n── Compartir varios a la vez ──');
await tiles.nth(0).click();
await tiles.nth(1).click();
await page.waitForTimeout(300);
await page.locator('.selbar__actions .btn', { hasText: 'Guardar' }).click();
// Se prepara primero: la hoja aparece cuando los archivos ya están leídos.
await page.waitForSelector('.sheet-backdrop', { timeout: 20_000 });
await page.waitForTimeout(600);
const titulo = await page.locator('.sheet__title').textContent();
check('la hoja anuncia los archivos preparados', /2 archivos/.test(titulo), titulo);

await page.locator('.sheet .btn--primary').click();
await page.waitForTimeout(900);
const log = await page.evaluate(() => window.__shareLog);
check('se comparten los dos archivos', log.length === 1 && log[0].archivos.length === 2,
  JSON.stringify(log[0]?.archivos?.map((f) => f.name)));
check('la llamada ocurre con la activación del usuario viva',
  log[0] && log[0].activo !== false,
  'userActivation.isActive = ' + log[0]?.activo);
check('los archivos llevan nombre y contenido',
  log[0]?.archivos?.every((f) => f.size > 1000 && /\.jpg$/.test(f.name)));
const nombres = log[0]?.archivos?.map((f) => f.name) || [];
check('cada archivo tiene un nombre distinto',
  new Set(nombres).size === nombres.length, nombres.join(', '));

console.log('\n── Exportar del laboratorio conserva la activación ──');
await page.evaluate(() => { window.__shareLog.length = 0; });
await page.locator('.lib__baractions .btn', { hasText: 'Hecho' }).click();
await page.waitForTimeout(300);
await page.locator('.tile').first().click();
await page.waitForFunction(() => !!window.__lab?.views?.lab?.proxy, null, { timeout: 60_000 });
await page.waitForTimeout(800);
await page.locator('.lab__export').click();
await page.waitForTimeout(600);
await page.locator('.sheet .btn--primary', { hasText: 'Guardar en el dispositivo' }).click();
// El revelado a resolución completa tarda lo suyo bajo SwiftShader, así que se
// espera a que aparezca ESA hoja y no a que haya una cualquiera.
await page.waitForFunction(
  () => document.querySelector('.sheet__title')?.textContent?.includes('Listo para guardar'),
  null, { timeout: 90_000 });
const listo = await page.locator('.sheet__title').textContent();
check('tras revelar se ofrece una hoja nueva, no se comparte a ciegas',
  /Listo para guardar/.test(listo) && (await page.evaluate(() => window.__shareLog.length)) === 0,
  listo + ' · llamadas a compartir antes del toque: ' + (await page.evaluate(() => window.__shareLog.length)));
await page.locator('.sheet .btn--primary').click();
await page.waitForTimeout(900);
const log2 = await page.evaluate(() => window.__shareLog);
check('el toque de esa hoja sí comparte, con activación viva',
  log2.length === 1 && log2[0].activo !== false,
  'archivos=' + log2.length + ' activo=' + log2[0]?.activo);

console.log('\n── Reserva cuando no hay hoja del sistema ──');
const fallback = await page.evaluate(async () => {
  const { saveFiles } = await import('./js/utils/share.js');
  const share = navigator.share, canShare = navigator.canShare;
  navigator.canShare = () => false;
  navigator.share = undefined;
  const c = document.createElement('canvas'); c.width = c.height = 40;
  c.getContext('2d').fillRect(0, 0, 40, 40);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg'));
  const result = await saveFiles([blob], ['prueba.jpg']);
  navigator.share = share; navigator.canShare = canShare;
  const overlay = document.querySelector('.longpress');
  const info = { result, overlay: !!overlay, tieneImagen: !!overlay?.querySelector('img') };
  overlay?.remove();
  return info;
});
check('sin hoja del sistema hay una salida y no un callejón',
  fallback.result === 'downloaded' || (fallback.result === 'longpress' && fallback.tieneImagen),
  JSON.stringify(fallback));

console.log('\n── Guardar manteniendo pulsado (reserva de iPhone) ──');
const longpress = await page.evaluate(async () => {
  const { showLongPressSave } = await import('./js/utils/share.js');
  const c = document.createElement('canvas'); c.width = c.height = 40;
  c.getContext('2d').fillStyle = '#c33'; c.getContext('2d').fillRect(0, 0, 40, 40);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg'));
  const overlay = showLongPressSave(blob, 'prueba.jpg');
  const img = overlay.querySelector('img');
  const info = {
    visible: getComputedStyle(overlay).display !== 'none',
    tieneImagen: !!img && img.src.startsWith('blob:'),

    texto: overlay.querySelector('.longpress__hint').textContent,
  };
  overlay.remove();
  return info;
});
check('la ventana de reserva muestra la imagen', longpress.visible && longpress.tieneImagen);
// `-webkit-touch-callout` es propiedad de WebKit y Chromium la descarta del
// CSSOM, así que no hay forma de observarla desde aquí. Se comprueba sobre la
// hoja SERVIDA, que es exactamente lo que recibirá Safari.
const css = await (await fetch(BASE + '/styles/app.css')).text();
check('la hoja servida declara el menú de mantener pulsado de iOS',
  /\.longpress__media\s*\{[^}]*-webkit-touch-callout:\s*default/.test(css));
check('nada global lo anula',
  !/(^|\})\s*(html|body|\*)[^{]*\{[^}]*(-webkit-touch-callout:\s*none|user-select:\s*none)/.test(css));
check('explica qué hacer', /pulsada/.test(longpress.texto), longpress.texto);

console.log('\n── Errores de consola ──');
const real = errors.filter((e) => !/favicon|vibrate/i.test(e));
check('sin errores', real.length === 0, real.slice(0, 3).join(' | '));

console.log(failures ? `\n${failures} fallo(s)\n` : '\nGuardar funciona.\n');
await browser.close();
server.kill();
process.exit(failures ? 1 : 0);
