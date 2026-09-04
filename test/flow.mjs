/** Prueba del recorrido de usuario: importar → laboratorio → ajustar → exportar. */
import pw from 'playwright';
const { chromium } = pw;
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOT = process.env.SHOT_DIR || ROOT + 'test/capturas';
const BASE = 'http://localhost:8098';

fs.mkdirSync(SHOT, { recursive: true });
const server = spawn('node', [ROOT + '/serve.mjs', '--port=8098'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));

let failures = 0;
const errors = [];
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failures++;
};

// Foto de prueba: 2400×1600 con degradado, cielo, piel y luces brillantes.
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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

console.log('\n── Generar foto de prueba y guardarla en la carpeta local ──');
const photoPath = SHOT + '/prueba.jpg';
const dataUrl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 2400; c.height = 1600;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 900);
  sky.addColorStop(0, '#2c5f9e'); sky.addColorStop(1, '#cfe0ea');
  g.fillStyle = sky; g.fillRect(0, 0, 2400, 900);
  g.fillStyle = '#3d5c3a'; g.fillRect(0, 900, 2400, 700);
  g.fillStyle = '#e0b89a'; g.beginPath(); g.arc(700, 950, 240, 0, 7); g.fill();
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(1900, 240, 110, 0, 7); g.fill();
  g.fillStyle = '#0a0a0a'; g.fillRect(1500, 1100, 500, 380);
  for (let i = 0; i < 10; i++) {
    g.fillStyle = `hsl(${i * 36} 78% 52%)`;
    g.fillRect(120 + i * 90, 1250, 70, 200);
  }
  return c.toDataURL('image/jpeg', 0.95);
});
fs.writeFileSync(photoPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('    ' + Math.round(fs.statSync(photoPath).size / 1024) + ' KB, 2400×1600');

await page.setInputFiles('input[type=file]', photoPath);
// Espera a que el laboratorio tenga el proxy listo, no a un tiempo fijo: bajo
// SwiftShader la descodificación tarda lo que le apetezca.
await page.waitForFunction(() => !!window.__lab?.views?.lab?.proxy, null, { timeout: 60000 });
await page.waitForTimeout(400);
const diag = await page.evaluate(() => ({
  current: window.__lab.current,
  hasItem: !!window.__lab.views.lab.item,
  hasProxy: !!window.__lab.views.lab.proxy,
  classes: window.__lab.views.lab.root.className,
}));
console.log('    diagnóstico: ' + JSON.stringify(diag));

check('la vista de laboratorio se activa', await page.locator('#view-lab.is-active').count() === 1);
check('el laboratorio tiene imagen', await page.locator('.view--lab.has-image').count() === 1);
const subtitle = await page.locator('.lab__subtitle').textContent();
check('muestra el original y el proxy', /2400×1600/.test(subtitle), subtitle);

const storageMode = await page.evaluate(async () => {
  const { library } = await import('./js/store/library.js');
  const u = await library.usage();
  return u;
});
check('el archivo está en la carpeta local', storageMode.count === 1 && storageMode.own > 0,
  storageMode.mode + ', ' + storageMode.count + ' archivo, ' + Math.round(storageMode.own / 1024) + ' KB');
check('usa OPFS y no memoria del navegador', storageMode.mode === 'opfs', storageMode.mode);

console.log('\n── Recorrer los paneles de ajustes ──');
const panels = await page.locator('.panelbar__tab').count();
check('hay 10 paneles', panels === 10, panels + ' encontrados');
for (const id of ['film', 'light', 'color', 'hsl', 'curves', 'grade', 'detail', 'effects', 'vignette', 'geometry']) {
  await page.locator(`.panelbar__tab[data-panel="${id}"]`).click();
  await page.waitForTimeout(320);
  const rendered = await page.locator(`.panel[data-panel="${id}"]`).count();
  check('panel ' + id.padEnd(9) + ' se abre', rendered === 1);
}
check('sin errores al recorrer paneles', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log('\n── Aplicar una emulsión desde el selector ──');
await page.locator('.panelbar__tab[data-panel="film"]').click();
await page.waitForTimeout(700);
const cards = await page.locator('.filmcard').count();
check('el selector muestra las 19 emulsiones', cards === 19, cards + '');
await page.locator('.filmcard[data-film="cinestill800t"]').click();
await page.waitForTimeout(900);
const noteText = await page.locator('.filmnote').textContent();
check('se aplica CineStill 800T', /CineStill/.test(noteText));
const stateAfterFilm = await page.evaluate(() => ({
  film: window.__lab.views.lab.params.film.id,
  halation: window.__lab.views.lab.params.effects.halation,
  temp: window.__lab.views.lab.params.color.temp,
}));
check('los ajustes reflejan la emulsión', stateAfterFilm.film === 'cinestill800t' && stateAfterFilm.halation > 0.5,
  JSON.stringify(stateAfterFilm));

console.log('\n── Mover deslizadores ──');
await page.locator('.panelbar__tab[data-panel="light"]').click();
await page.waitForTimeout(300);
await page.evaluate(() => {
  const s = document.querySelector('.slider[data-path="light.exposure"] input');
  s.value = '0.8';
  s.dispatchEvent(new Event('input', { bubbles: true }));
  s.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(500);
const exposure = await page.evaluate(() => window.__lab.views.lab.params.light.exposure);
check('la exposición se aplica', Math.abs(exposure - 0.8) < 1e-6, exposure + ' EV');
const badge = await page.locator('.panelbar__tab[data-panel="light"].is-modified').count();
check('el panel se marca como modificado', badge === 1);

console.log('\n── Deshacer y rehacer ──');
await page.waitForTimeout(500);
await page.locator('.iconbtn[aria-label="Deshacer"]').click();
await page.waitForTimeout(400);
const afterUndo = await page.evaluate(() => window.__lab.views.lab.params.light.exposure);
check('deshacer revierte la exposición', Math.abs(afterUndo) < 1e-6, afterUndo + ' EV');
await page.locator('.iconbtn[aria-label="Rehacer"]').click();
await page.waitForTimeout(400);
const afterRedo = await page.evaluate(() => window.__lab.views.lab.params.light.exposure);
check('rehacer la recupera', Math.abs(afterRedo - 0.8) < 1e-6, afterRedo + ' EV');

console.log('\n── Exportar a resolución completa ──');
const exported = await page.evaluate(async () => {
  const lab = window.__lab.views.lab;
  const { library, decodeScaled } = await import('./js/store/library.js');
  const { renderToBlob } = await import('./js/engine/renderer.js');
  const file = await library.getFile(lab.item.id);
  const { bitmap } = await decodeScaled(file, 1e9);
  const t0 = performance.now();
  const res = await renderToBlob(bitmap, lab.params, { type: 'image/jpeg', quality: 0.95 });
  const ms = performance.now() - t0;
  bitmap.close?.();
  // Comprobar que el JPEG es válido descodificándolo de vuelta.
  const back = await createImageBitmap(res.blob);
  const dims = { w: back.width, h: back.height };
  back.close?.();
  return { width: res.width, height: res.height, bytes: res.blob.size, type: res.blob.type, scaled: res.scaled, ms: Math.round(ms), dims };
});
check('exporta a la resolución original', exported.width === 2400 && exported.height === 1600,
  exported.width + '×' + exported.height);
check('sin reducir por límite de textura', exported.scaled === false);
check('el JPEG es válido y se puede volver a abrir',
  exported.dims.w === 2400 && exported.dims.h === 1600 && exported.type === 'image/jpeg',
  Math.round(exported.bytes / 1024) + ' KB en ' + exported.ms + ' ms');

console.log('\n── Guardar el resultado en la biblioteca ──');
await page.evaluate(async () => {
  const lab = window.__lab.views.lab;
  await lab._export({ size: 'full', format: 'image/jpeg', quality: 0.92 }, 'library');
});
await page.waitForTimeout(1200);
await page.locator('.tabbar__tab[data-tab="library"]').click();
await page.waitForTimeout(1200);
const tiles = await page.locator('.tile').count();
check('la biblioteca muestra ambos archivos', tiles === 2, tiles + ' miniaturas');
const usageText = await page.locator('.usage__mode').textContent();
check('indica la carpeta local', /Carpeta local/.test(usageText), usageText);

console.log('\n── Recorte ──');
await page.locator('.tabbar__tab[data-tab="lab"]').click();
await page.waitForTimeout(600);
await page.locator('.panelbar__tab[data-panel="geometry"]').click();
await page.waitForTimeout(500);
check('la superposición de recorte aparece', await page.locator('.crop:not([hidden])').count() === 1);
await page.locator('.seg__item[data-value="1:1"]').click();
await page.waitForTimeout(600);
const cropState = await page.evaluate(() => window.__lab.views.lab.params.geometry.crop);
const cropAspect = (cropState.w * 2400) / (cropState.h * 1600);
check('la proporción 1:1 recorta correctamente', Math.abs(cropAspect - 1) < 0.02,
  'aspecto resultante ' + cropAspect.toFixed(4));

console.log('\n── Persistencia entre sesiones ──');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2200);
const afterReload = await page.evaluate(async () => {
  const { library } = await import('./js/store/library.js');
  const items = await library.list();
  return { count: items.length, hasParams: !!items.find((i) => i.params) };
});
check('los archivos sobreviven a la recarga', afterReload.count === 2, afterReload.count + ' archivos');
check('los ajustes se guardan con el archivo', afterReload.hasParams);

console.log('\n── Capturas ──');
await page.locator('.tabbar__tab[data-tab="library"]').click();
await page.waitForTimeout(1200);
await page.screenshot({ path: SHOT + '/ui-library.png' });
const lastItem = await page.evaluate(async () => {
  const { library } = await import('./js/store/library.js');
  const items = await library.list();
  window.__lab.openInLab(items[items.length - 1]);
  return items[items.length - 1].id;
});
await page.waitForTimeout(2200);
await page.locator('.panelbar__tab[data-panel="film"]').click();
await page.waitForTimeout(2500);
await page.screenshot({ path: SHOT + '/ui-lab-film.png' });
await page.locator('.panelbar__tab[data-panel="curves"]').click();
await page.waitForTimeout(900);
await page.screenshot({ path: SHOT + '/ui-lab-curves.png' });
await page.locator('.panelbar__tab[data-panel="grade"]').click();
await page.waitForTimeout(700);
await page.screenshot({ path: SHOT + '/ui-lab-grade.png' });
await page.locator('.tabbar__tab[data-tab="camera"]').click();
await page.waitForTimeout(2500);
await page.screenshot({ path: SHOT + '/ui-camera.png' });
console.log('    guardadas en ' + SHOT);

console.log('\n── Errores de consola ──');
const real = errors.filter((e) => !/vibrate|favicon/i.test(e));
check('sin errores', real.length === 0, real.slice(0, 3).join(' | '));

console.log('\nResultado: ' + (failures ? failures + ' fallo(s)' : 'todo correcto'));
await browser.close();
server.kill();
process.exit(failures ? 1 : 0);
